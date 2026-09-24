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
 * The source is the price, both ways (owner, Sept 2026: "any price changes
 * should update right away"). So the NEWEST read per product decides:
 *   - a price           -> applied, including onto a product that has none
 *                          (Euronics re-listing it), sanity-checked against the
 *                          last price this source gave for it;
 *   - "no_offer" twice  -> the price comes down to "call for price". Twice, on
 *                          consecutive reads, because one bad page must never
 *                          take a live price off the shelf.
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
  applied: { productId: string; productCode: string; title: string; from: number | null; to: number | null }[];
  unchanged: number;
  refused: Record<string, number>; // guard code -> count
  halted: boolean;
  haltReason: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * How many prices one run may change before it applies none. A quarter of the
 * lines it read, never under 100: a broken parser moves nearly every line, a
 * real Euronics repricing a few per cent. The flat 100 held a whole night's
 * changes when Euronics repriced ~150 lines on 23 Sept 2026, and the nightly
 * run now reads every line (~3,000). A caller may ask for less, never more.
 */
export const changeBudget = (considered: number, requested?: number) =>
  Math.max(1, Math.min(requested ?? Infinity, Math.max(100, Math.floor(considered / 4))));
const CFG = DEFAULT_GUARD_CONFIG;

export async function autoApplySource(
  db: any,
  opts: { sourceId: string; maxChanges?: number; appliedBy?: string },
): Promise<AutoApplyOutcome> {
  const sourceId = opts.sourceId;
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

  // Every priced or no-offer read for this source, newest first. The window is
  // wider than the freshness guard on purpose: the nightly run rotates, so a
  // product's previous read can be a week old, and "no offer twice in a row"
  // and "the last price it gave" both need to see it. Freshness of the read
  // being ACTED on is still enforced by the stale_observation guard.
  const since = new Date(Date.now() - 3 * CFG.staleAfterDays * 86400_000);
  const observations = await db.priceObservation.findMany({
    where: { sourceId, status: { in: ["ok", "no_offer"] }, observedAt: { gte: since } },
    orderBy: { observedAt: "desc" },
  });
  const history = new Map<string, any[]>();
  for (const o of observations) {
    if (o.status === "ok" && !(typeof o.price === "number" && o.price > 0)) continue;
    const h = history.get(o.productId) || [];
    h.push(o);
    history.set(o.productId, h);
  }
  const latest = new Map<string, any>();
  for (const [id, h] of history) latest.set(id, h[0]);
  if (!latest.size) return out;

  const [products, poaNames] = await Promise.all([
    db.product.findMany({ where: { id: { in: [...latest.keys()] } } }),
    poaNamesFromDb(db),
  ]);

  type Candidate = { p: any; obs: any; proposedPrice: number | null };
  const candidates: Candidate[] = [];

  for (const p of products) {
    out.considered++;
    const obs = latest.get(p.id);
    const isPoa = isPoaProduct(poaNames, { category: p.category, subcategory: p.subcategory, brand: p.brand });

    if (obs.status === "no_offer") {
      if (p.priceNow === null) { out.unchanged++; continue; }
      if (isPoa) { refuse("poa_category"); continue; }
      const prev = history.get(p.id)![1];
      if (!prev || prev.status !== "no_offer") { refuse("no_offer_unconfirmed"); continue; }
      const fresh = Date.now() - new Date(obs.observedAt).getTime() <= CFG.staleAfterDays * 86400_000;
      if (!fresh) { refuse("stale_observation"); continue; }
      candidates.push({ p, obs, proposedPrice: null });
      continue;
    }

    const includesVat = typeof obs.includesVat === "boolean" ? obs.includesVat : source.priceIncludesVat !== false;
    const vatConverted = includesVat === false;
    const proposedPrice = round2(includesVat ? obs.price : obs.price * (1 + CFG.vatRate));
    const deliveryCost = typeof obs.deliveryCost === "number"
      ? round2(includesVat ? obs.deliveryCost : obs.deliveryCost * (1 + CFG.vatRate))
      : null;
    if (typeof p.priceNow === "number" && Math.abs(p.priceNow - proposedPrice) < 0.01) { out.unchanged++; continue; }

    // No price on our shelf: measure the move against the last price this
    // source gave, so a re-listed product comes back but a mis-read (£1,099 ->
    // £1) is still caught by implausible_move. Never priced by this source ->
    // no reference, and no_current_price keeps it for a human.
    let currentPrice: number | null = typeof p.priceNow === "number" ? p.priceNow : null;
    if (currentPrice === null) {
      const lastPriced = history.get(p.id)!.find((o, i) => i > 0 && o.status === "ok");
      if (lastPriced) currentPrice = round2(lastPriced.includesVat === false ? lastPriced.price * (1 + CFG.vatRate) : lastPriced.price);
    }
    let g;
    try {
      g = evaluateGuards({
        proposal: {
          productId: p.id,
          currentPrice,
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
    // One PRODUCT, counted once, under its first reason. forEach(refuse) tallied
    // guard CODES, so a product with three blockers was reported as three held
    // items and the run summary did not reconcile with `considered`.
    if (!g.allowed || g.blocking.length) { refuse(g.blocking[0] || "blocked"); continue; }
    candidates.push({ p, obs, proposedPrice });
  }

  // ---- circuit breaker: all or nothing ----
  const maxChanges = changeBudget(out.considered, opts.maxChanges);
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
    // lie on the product card — drop it rather than leave it stranded. With no
    // price at all there is nothing for a "was" to be above.
    if (proposedPrice === null || !(typeof p.priceWas === "number" && p.priceWas > proposedPrice)) data.priceWas = null;
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
        ...(proposedPrice === null ? { reason: `${source.label} shows no offer on two consecutive reads` } : {}),
        ...(p.priceNow === null && proposedPrice !== null ? { reason: `${source.label} is selling it again` } : {}),
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
