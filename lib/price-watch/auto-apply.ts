import { evaluateGuards, DEFAULT_GUARD_CONFIG } from "@/lib/price-watch/guards";
import { isPoaProduct, poaNamesFromDb } from "@/lib/poa";
import { reconcileSaving } from "@/lib/admin-product";
import { writeAudit } from "@/lib/audit";

/**
 * UNATTENDED price application — the machine path.
 *
 * The admin Apply button runs manualBlockers() because a human is the
 * authority. Here there is no human, so the FULL guard set must pass:
 * source must be `authorised` + `enabled` + `allowAutoApply`, the product
 * must clear every blocking guard (for agency/mandated stock the cost-floor
 * and delivery guards are exempt by design — compliance, not a decision),
 * and the observation must be fresh, exact-match and complete.
 *
 * Circuit breaker: if MORE candidates pass than `maxChanges`, we apply NONE.
 * A corrupted feed or a broken parser looks exactly like "everything changed
 * at once", and the safe reading of that is "stop and ask a human" — not
 * "apply the first N of it". The held run is visible in lastRunStatus and the
 * admin panel, never silent.
 */

export type AutoApplyOutcome = {
  sourceId: string;
  considered: number;
  applied: { productId: string; productCode: string; title: string; from: number | null; to: number }[];
  unchanged: number;
  refused: Record<string, number>; // guard code -> count
  halted: boolean;
  haltReason: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const CFG = DEFAULT_GUARD_CONFIG;

export async function autoApplySource(
  db: any,
  opts: { sourceId: string; maxChanges?: number; appliedBy?: string },
): Promise<AutoApplyOutcome> {
  const sourceId = opts.sourceId;
  const maxChanges = Math.min(Math.max(1, opts.maxChanges ?? 25), 100);
  const appliedBy = opts.appliedBy || "price-agent (automated)";
  const out: AutoApplyOutcome = {
    sourceId, considered: 0, applied: [], unchanged: 0, refused: {}, halted: false, haltReason: "",
  };
  const refuse = (code: string) => { out.refused[code] = (out.refused[code] || 0) + 1; };

  const source = await db.priceSource.findUnique({ where: { id: sourceId } });
  // The three source-level switches are checked here AND inside the guards —
  // an endpoint bug cannot skip them because evaluateGuards re-blocks each row.
  if (!source) { out.halted = true; out.haltReason = "source_not_found"; return out; }
  if (source.kind !== "authorised" || !source.enabled || source.allowAutoApply !== true) {
    out.halted = true;
    out.haltReason = `source not eligible (kind=${source.kind}, enabled=${source.enabled}, allowAutoApply=${source.allowAutoApply})`;
    return out;
  }

  // Latest usable observation per product for this source, one query.
  const since = new Date(Date.now() - CFG.staleAfterDays * 86400_000);
  const observations = await db.priceObservation.findMany({
    where: { sourceId, status: "ok", price: { not: null }, observedAt: { gte: since } },
    orderBy: { observedAt: "desc" },
  });
  const latest = new Map<string, any>();
  for (const o of observations) if (!latest.has(o.productId)) latest.set(o.productId, o);
  if (!latest.size) return out;

  const [products, poaNames] = await Promise.all([
    db.product.findMany({ where: { id: { in: [...latest.keys()] } } }),
    poaNamesFromDb(db),
  ]);

  type Candidate = { p: any; obs: any; proposedPrice: number };
  const candidates: Candidate[] = [];

  for (const p of products) {
    out.considered++;
    const obs = latest.get(p.id);
    const includesVat = typeof obs.includesVat === "boolean" ? obs.includesVat : source.priceIncludesVat !== false;
    const vatConverted = includesVat === false;
    const proposedPrice = round2(includesVat ? obs.price : obs.price * (1 + CFG.vatRate));
    const deliveryCost = typeof obs.deliveryCost === "number"
      ? round2(includesVat ? obs.deliveryCost : obs.deliveryCost * (1 + CFG.vatRate))
      : null;
    if (typeof p.priceNow === "number" && Math.abs(p.priceNow - proposedPrice) < 0.01) { out.unchanged++; continue; }

    const isPoa = isPoaProduct(poaNames, { category: p.category, subcategory: p.subcategory });
    let g;
    try {
      g = evaluateGuards({
        proposal: {
          productId: p.id,
          currentPrice: typeof p.priceNow === "number" ? p.priceNow : null,
          proposedPrice,
          sourceId,
          sourceKind: String(source.kind),
          sourceAllowsAutoApply: true,
          vatConversionApplied: vatConverted,
          observation: {
            price: obs.price,
            deliveryCost,
            inStock: typeof obs.inStock === "boolean" ? obs.inStock : null,
            includesVat,
            matchConfidence: typeof obs.matchConfidence === "number" ? obs.matchConfidence : 0,
            status: String(obs.status || ""),
            sourceUrl: String(obs.sourceUrl || ""),
            observedAt: obs.observedAt instanceof Date ? obs.observedAt : new Date(obs.observedAt),
          },
        },
        product: {
          costPrice: typeof p.costPrice === "number" ? p.costPrice : null,
          floorPrice: typeof p.floorPrice === "number" ? p.floorPrice : null,
          category: p.category,
          subcategory: p.subcategory,
          isPoa,
          mandated: p.agencyStock === true,
        },
        poaNames,
        config: CFG,
        now: new Date(),
      });
    } catch {
      refuse("guard_error"); continue; // fail closed
    }
    if (isPoa && !g.blocking.includes("poa_category")) g.blocking.push("poa_category");
    if (!g.allowed || g.blocking.length) { g.blocking.forEach(refuse); continue; }
    candidates.push({ p, obs, proposedPrice });
  }

  // ---- circuit breaker: all or nothing ----
  if (candidates.length > maxChanges) {
    out.halted = true;
    out.haltReason = `${candidates.length} changes exceed the ${maxChanges}-change budget — held for review`;
    await db.priceSource.update({
      where: { id: sourceId },
      data: { lastRunStatus: `HALTED: ${out.haltReason}`.slice(0, 200) },
    });
    return out;
  }

  for (const { p, obs, proposedPrice } of candidates) {
    const data: Record<string, any> = { priceNow: proposedPrice };
    // A "was" that is no longer above the new price is not a saving, it is a
    // lie on the product card — drop it rather than leave it stranded.
    if (!(typeof p.priceWas === "number" && p.priceWas > proposedPrice)) data.priceWas = null;
    reconcileSaving(data, p);
    // Lock the fields, exactly as a manual edit does, so the next catalogue
    // re-import cannot quietly undo the applied price.
    const overrides = new Set<string>((p.adminOverrideFields as string[]) || []);
    overrides.add("priceNow");
    if ("priceWas" in data) overrides.add("priceWas");
    if ("saving" in data) overrides.add("saving");
    data.adminOverrideFields = [...overrides];
    data.lastUpdatedByAdmin = new Date();

    await db.product.update({ where: { id: p.id }, data });
    await writeAudit(db, {
      entityType: "product",
      entityId: p.id,
      action: "price-watch:auto-apply",
      changedFields: Object.keys(data).filter((k) => k !== "adminOverrideFields" && k !== "lastUpdatedByAdmin"),
      previousValue: { priceNow: p.priceNow ?? null, priceWas: p.priceWas ?? null, saving: p.saving ?? null },
      newValue: {
        priceNow: data.priceNow,
        priceWas: "priceWas" in data ? data.priceWas : (p.priceWas ?? null),
        saving: data.saving ?? null,
        sourceId,
        sourceLabel: source.label,
        observationId: obs.id,
        observedAt: obs.observedAt,
        observedPrice: obs.price,
      },
      changedBy: appliedBy,
    });
    out.applied.push({ productId: p.id, productCode: p.productCode || "", title: p.title || "", from: p.priceNow ?? null, to: proposedPrice });
  }

  const summary = `auto: ${out.applied.length} applied, ${out.unchanged} unchanged, ${Object.values(out.refused).reduce((a, b) => a + b, 0)} held`;
  await db.priceSource.update({
    where: { id: sourceId },
    data: { lastRunAt: new Date(), lastRunStatus: summary.slice(0, 200) },
  });
  return out;
}
