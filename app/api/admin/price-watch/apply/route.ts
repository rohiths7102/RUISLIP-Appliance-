import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { reconcileSaving } from "@/lib/admin-product";
import { poaNamesFromDb, isPoaProduct } from "@/lib/poa";
import { revalidateStorefront } from "@/lib/revalidate";
import { DEFAULT_GUARD_CONFIG, evaluateGuards } from "@/lib/price-watch/guards";
import { syncProductToRag } from "@/lib/rag/index";

export const dynamic = "force-dynamic";

/**
 * Copy a watched source's price onto our own products — the owner-driven half
 * of price watch.
 *
 * Session auth, NOT machine auth: this is a human pressing Apply in the admin,
 * so it sits behind the admin cookie and the admin IP allowlist like every
 * other /api/admin route. The machine-signed ingest routes are the ones that
 * must stay outside that allowlist; nothing here is reachable by a collector.
 *
 * The browser's view of what is safe is thrown away. Every product is re-read,
 * its latest observation re-read, and the guards re-run here before anything is
 * written — a stale tab, a hand-crafted POST, or a floor price that changed a
 * second ago all end the same way: refused, with the reason returned.
 *
 * Body: { productIds: string[], sourceId: string }
 */
const MAX_IDS = 200;

/** One config for the guards, the admin screen and this route. */
const CFG = DEFAULT_GUARD_CONFIG;

const round2 = (n: number) => Math.round(n * 100) / 100;

type Result = {
  productId: string;
  productCode: string;
  title: string;
  status: "applied" | "refused" | "unchanged";
  from: number | null;
  to: number | null;
  reasons: string[];
};

export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 20, windowMs: 60_000, bucket: "price-watch-apply" });
  if ("response" in gate) return gate.response;
  const admin = gate.admin;

  const body = await req.json().catch(() => ({}));
  const productIds: string[] = Array.isArray(body.productIds)
    ? [...new Set<string>(body.productIds.filter((x: any): x is string => typeof x === "string" && !!x))]
    : [];
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";

  if (!sourceId) return NextResponse.json({ error: "No price source chosen" }, { status: 400 });
  if (!productIds.length) return NextResponse.json({ error: "No products selected" }, { status: 400 });
  if (productIds.length > MAX_IDS)
    return NextResponse.json({ error: `Too many at once (max ${MAX_IDS})` }, { status: 400 });

  try {
    const db = await getPrisma();

    const source = await db.priceSource.findUnique({ where: { id: sourceId } });
    if (!source) return NextResponse.json({ error: "That price source no longer exists" }, { status: 404 });
    if (!source.enabled)
      return NextResponse.json({ error: `“${source.label}” is switched off — turn it back on first` }, { status: 400 });

    const [products, observations, poaNames] = await Promise.all([
      db.product.findMany({ where: { id: { in: productIds } } }),
      // Newest first, then keep the first row seen per product: one query for
      // the latest observation of every selected product from this source.
      db.priceObservation.findMany({
        where: { productId: { in: productIds }, sourceId },
        orderBy: { observedAt: "desc" },
      }),
      poaNamesFromDb(db),
    ]);

    const latest = new Map<string, any>();
    for (const o of observations as any[]) if (!latest.has(o.productId)) latest.set(o.productId, o);
    const byId = new Map((products as any[]).map((p) => [p.id, p]));

    const results: Result[] = [];
    let applied = 0;

    for (const id of productIds) {
      const p = byId.get(id);
      if (!p) {
        results.push({ productId: id, productCode: "", title: "", status: "refused", from: null, to: null, reasons: ["not_found"] });
        continue;
      }
      const base = { productId: id, productCode: p.productCode || "", title: p.title || "", from: p.priceNow ?? null };

      const obs = latest.get(id);
      if (!obs) {
        results.push({ ...base, status: "refused", to: null, reasons: ["no_observation"] });
        continue;
      }
      if (typeof obs.price !== "number" || !Number.isFinite(obs.price)) {
        results.push({ ...base, status: "refused", to: null, reasons: ["no_price"] });
        continue;
      }

      // VAT normalisation, mirroring lib/price-watch/queries.ts: the observation's
      // OWN includesVat is authoritative (it was copied from the source at observe
      // time so a later config change cannot retro-reinterpret it); the source row
      // is only the fallback. Applying a trade quote as-is would under-price by the
      // whole VAT rate, which is why this is never inferred from the number itself.
      const includesVat = typeof obs.includesVat === "boolean" ? obs.includesVat : source.priceIncludesVat !== false;
      const vatConverted = includesVat === false;
      const proposedPrice = round2(includesVat ? obs.price : obs.price * (1 + CFG.vatRate));
      const deliveryCost =
        typeof obs.deliveryCost === "number"
          ? round2(includesVat ? obs.deliveryCost : obs.deliveryCost * (1 + CFG.vatRate))
          : null;

      const isPoa = isPoaProduct(poaNames, { category: p.category, subcategory: p.subcategory });

      let verdict: { allowed: boolean; blocking: string[] };
      try {
        const g = evaluateGuards({
          proposal: {
            productId: p.id,
            currentPrice: typeof p.priceNow === "number" ? p.priceNow : null,
            proposedPrice,
            sourceId,
            sourceKind: String(source.kind || "advisory"),
            sourceAllowsAutoApply: source.allowAutoApply === true,
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
          },
          poaNames,
          config: CFG,
          now: new Date(),
        });
        verdict = { allowed: g.allowed && g.blocking.length === 0, blocking: g.blocking };
      } catch {
        // Fail closed: a guard module that throws refuses the write.
        verdict = { allowed: false, blocking: ["guard_error"] };
      }

      // Belt and braces on the one rule that must never be got wrong: a
      // call-for-price range keeps its price hidden even if a guard regressed.
      if (isPoa && !verdict.blocking.includes("poa_category")) {
        verdict = { allowed: false, blocking: [...verdict.blocking, "poa_category"] };
      }

      if (!verdict.allowed) {
        results.push({ ...base, status: "refused", to: proposedPrice, reasons: verdict.blocking });
        continue;
      }
      if (p.priceNow === proposedPrice) {
        results.push({ ...base, status: "unchanged", to: proposedPrice, reasons: [] });
        continue;
      }

      const data: Record<string, any> = { priceNow: proposedPrice };
      // A "was" that is no longer above the new price is not a saving, it is a
      // lie on the product card — drop it rather than leave it stranded.
      if (!(typeof p.priceWas === "number" && p.priceWas > proposedPrice)) data.priceWas = null;
      reconcileSaving(data, p);

      // Lock the fields, exactly as a manual edit does, so the next catalogue
      // re-import cannot quietly undo the price the owner just agreed to.
      const overrides = new Set<string>(((p.adminOverrideFields as string[]) || []));
      overrides.add("priceNow");
      if ("priceWas" in data) overrides.add("priceWas");
      if ("saving" in data) overrides.add("saving");
      data.adminOverrideFields = [...overrides];
      data.lastUpdatedByAdmin = new Date();

      await db.product.update({ where: { id: p.id }, data });
      await writeAudit(db, {
        entityType: "product",
        entityId: p.id,
        action: "price-watch:apply",
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
          vatConverted,
        },
        changedBy: admin.email,
      });
      try { await syncProductToRag(db, p.id); } catch { /* best effort — the chatbot index may lag, the price does not */ }

      results.push({ ...base, status: "applied", to: proposedPrice, reasons: [] });
      applied++;
    }

    // A multi-product price change reaches the listings, the cards and the
    // detail pages, so this deliberately fans out (revalidate.ts treats a
    // non-detail path list as allPages) rather than naming individual slugs.
    if (applied) revalidateStorefront(["/", "/products"]);

    return NextResponse.json({
      ok: true,
      applied,
      refused: results.filter((r) => r.status === "refused").length,
      unchanged: results.filter((r) => r.status === "unchanged").length,
      sourceId,
      sourceLabel: source.label,
      results,
    });
  } catch (e) {
    console.error("price-watch apply", e);
    return NextResponse.json({ error: "Could not apply those prices. Is the database running?" }, { status: 500 });
  }
}
