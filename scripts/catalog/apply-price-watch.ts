/**
 * Apply reviewed price-watch observations from one source.
 *
 *   npx tsx scripts/catalog/apply-price-watch.ts --source euronics            # dry run
 *   npx tsx scripts/catalog/apply-price-watch.ts --source euronics --apply
 *
 * The admin screen already does this, but /api/admin/price-watch/apply needs an
 * admin SESSION, and a local dev database has no admin credentials set. This is
 * the same operation for the command line.
 *
 * It imports the real guard module rather than restating its rules, so the
 * verdict here is byte-identical to the one the Apply button produces:
 * evaluateGuards + manualBlockers (a human pressing Apply clears the auto-only
 * blockers, not the money-critical ones), the POA belt-and-braces check, the
 * priceWas/saving reconciliation, and the adminOverrideFields lock that stops a
 * later re-import undoing the price.
 */
import { getPrisma } from "../../lib/prisma.js";
import { poaNamesFromDb, isPoaProduct } from "../../lib/poa.js";
import { reconcileSaving } from "../../lib/admin-product.js";
import { DEFAULT_GUARD_CONFIG, evaluateGuards, manualBlockers } from "../../lib/price-watch/guards.js";

const args = process.argv.slice(2);
const argOf = (n: string, d = "") => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? d) : d; };
const SOURCE = argOf("--source", "euronics");
const APPLY = args.includes("--apply");
const CFG = DEFAULT_GUARD_CONFIG;
const round2 = (n: number) => Math.round(n * 100) / 100;

const db: any = await getPrisma();
const source = await db.priceSource.findUnique({ where: { id: SOURCE } });
if (!source) { console.error(`no such price source: ${SOURCE}`); process.exit(1); }
if (!source.enabled) { console.error(`"${source.label}" is switched off`); process.exit(1); }

const obsAll = await db.priceObservation.findMany({
  where: { sourceId: SOURCE, status: "ok" }, orderBy: { observedAt: "desc" },
});
const latest = new Map<string, any>();
for (const o of obsAll) if (!latest.has(o.productId)) latest.set(o.productId, o);

const products = await db.product.findMany({ where: { id: { in: [...latest.keys()] } } });
const poaNames = await poaNamesFromDb(db);

let applied = 0, unchanged = 0, refused = 0;
const refusedBy: Record<string, number> = {};
const changes: string[] = [];

for (const p of products) {
  const obs = latest.get(p.id);
  if (typeof obs?.price !== "number" || !Number.isFinite(obs.price)) { refused++; refusedBy.no_price = (refusedBy.no_price || 0) + 1; continue; }

  const includesVat = typeof obs.includesVat === "boolean" ? obs.includesVat : source.priceIncludesVat !== false;
  const proposedPrice = round2(includesVat ? obs.price : obs.price * (1 + CFG.vatRate));
  const deliveryCost = typeof obs.deliveryCost === "number"
    ? round2(includesVat ? obs.deliveryCost : obs.deliveryCost * (1 + CFG.vatRate)) : null;
  const isPoa = isPoaProduct(poaNames, { category: p.category, subcategory: p.subcategory });

  let blocking: string[];
  try {
    const g = evaluateGuards({
      proposal: {
        productId: p.id,
        currentPrice: typeof p.priceNow === "number" ? p.priceNow : null,
        proposedPrice, sourceId: SOURCE,
        sourceKind: String(source.kind || "advisory"),
        sourceAllowsAutoApply: source.allowAutoApply === true,
        vatConversionApplied: includesVat === false,
        observation: {
          price: obs.price, deliveryCost,
          inStock: typeof obs.inStock === "boolean" ? obs.inStock : null,
          includesVat,
          matchConfidence: typeof obs.matchConfidence === "number" ? obs.matchConfidence : 0,
          status: String(obs.status || ""), sourceUrl: String(obs.sourceUrl || ""),
          observedAt: obs.observedAt instanceof Date ? obs.observedAt : new Date(obs.observedAt),
        },
      },
      product: {
        costPrice: typeof p.costPrice === "number" ? p.costPrice : null,
        floorPrice: typeof p.floorPrice === "number" ? p.floorPrice : null,
        category: p.category, subcategory: p.subcategory, isPoa,
        mandated: p.agencyStock === true,
      },
      poaNames, config: CFG, now: new Date(),
    });
    blocking = manualBlockers(g.blocking);
  } catch { blocking = ["guard_error"]; }
  if (isPoa && !blocking.includes("poa_category")) blocking.push("poa_category");

  if (blocking.length) { refused++; for (const b of blocking) refusedBy[b] = (refusedBy[b] || 0) + 1; continue; }
  if (p.priceNow === proposedPrice) { unchanged++; continue; }

  changes.push(`  ${String(p.productCode).padEnd(18)} £${String(p.priceNow).padEnd(9)} -> £${proposedPrice}`);
  if (APPLY) {
    const data: Record<string, any> = { priceNow: proposedPrice };
    if (!(typeof p.priceWas === "number" && p.priceWas > proposedPrice)) data.priceWas = null;
    reconcileSaving(data, p);
    const ovr = new Set<string>(((p.adminOverrideFields as string[]) || []));
    ovr.add("priceNow"); if ("priceWas" in data) ovr.add("priceWas"); if ("saving" in data) ovr.add("saving");
    data.adminOverrideFields = [...ovr];
    data.lastUpdatedByAdmin = new Date();
    await db.product.update({ where: { id: p.id }, data });
  }
  applied++;
}

console.log(`source "${source.label}" — ${products.length} products with an observation${APPLY ? "" : "   (DRY RUN)"}\n`);
console.log(`  would change  : ${applied}`);
console.log(`  already equal : ${unchanged}`);
console.log(`  REFUSED       : ${refused}`);
for (const [k, v] of Object.entries(refusedBy).sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(4)}  ${k}`);
console.log(`\nsample of the changes:`);
console.log(changes.slice(0, 15).join("\n"));
console.log(APPLY ? `\nAPPLIED ${applied}. Run recompute-counts + rag:build if needed.` : `\n(dry run — nothing written)`);
await db.$disconnect();
