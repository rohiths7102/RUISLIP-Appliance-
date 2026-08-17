/**
 * Import the CIH/Euronics daily price feed into the catalogue.
 *
 *   python scripts/catalog/euronics-xlsx-extract.py "Price-List.xlsx" feed.json
 *   node   scripts/catalog/import-euronics-feed.mjs feed.json [--dry-run]
 *
 * Two distinct effects, deliberately kept apart:
 *
 *  1. ENRICH (always, safe): write costPrice (from B2B, ex-VAT) and gtin (from
 *     EAN) onto every product whose Model Number matches. This is owner data,
 *     the same class as a CSV import — it changes NO displayed price. It unlocks
 *     the floor guard (real cost) and Google Merchant's free price benchmark
 *     (a valid g:gtin in the feed).
 *
 *  2. OBSERVE (always): record the B2C Agency Price (retail, inc-VAT) as a
 *     PriceObservation under the authorised "cih" source, so every product where
 *     our shelf price differs lands in /admin/price-watch for a human to apply
 *     with one click. It does NOT change priceNow — applying stays a human act,
 *     exactly as with the scraped source.
 *
 * Runs against whatever the with-prod-db helper points DATABASE_URL at, so:
 *   local:  DATABASE_URL=file:./dev.db node scripts/catalog/import-euronics-feed.mjs feed.json
 *   prod:   node scripts/db/engine.mjs client:pg   (once), then
 *           PRISMA_CLIENT_DIR=.prisma-pg/client node scripts/db/with-prod-db.mjs \
 *             scripts/catalog/import-euronics-feed.mjs feed.json
 */
import { createRequire } from "module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const SOURCE_ID = "cih";
const DRY = process.argv.includes("--dry-run");
const feedPath = process.argv.find((a) => a.endsWith(".json"));
if (!feedPath) { console.error("usage: import-euronics-feed.mjs <feed.json> [--dry-run]"); process.exit(1); }

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
const cleanEan = (v) => { const d = String(v ?? "").replace(/[^0-9]/g, ""); return /^\d{8,14}$/.test(d) ? d : ""; };

const feed = JSON.parse(readFileSync(feedPath, "utf8"));
const byModel = new Map();
for (const r of feed) { const k = norm(r.model); if (k && !byModel.has(k)) byModel.set(k, r); }
console.log(`feed rows: ${feed.length} (${byModel.size} unique model numbers) ${DRY ? "— DRY RUN" : ""}`);

const db = new PrismaClient();

// The feed's B2C Agency Price is inc-VAT retail — make sure the source says so,
// or the guards would misread the basis and the applied price would be wrong.
const src = await db.priceSource.findUnique({ where: { id: SOURCE_ID } });
if (!src) { console.error(`No PriceSource "${SOURCE_ID}" — seed it first.`); process.exit(1); }
if (!DRY && (src.priceIncludesVat !== true || src.enabled !== true)) {
  await db.priceSource.update({ where: { id: SOURCE_ID }, data: { priceIncludesVat: true, enabled: true, kind: "authorised" } });
}

const products = await db.product.findMany({ select: { id: true, productCode: true, priceNow: true, costPrice: true, gtin: true } });

let enriched = 0, costSet = 0, eanSet = 0, observed = 0, gaps = 0, matched = 0;
const now = new Date();
const obsRows = [];
const big = [];

for (const p of products) {
  const f = byModel.get(norm(p.productCode));
  if (!f) continue;
  matched++;

  // 1. enrich gtin + agency flag + (central only) cost.
  // The feed's B2B is the buying group's cost basis. For AGENCY stock the shop
  // never buys the unit — it earns commission — so B2B is NOT the shop's cost
  // and storing it as costPrice would compute a bogus floor that blocks the
  // mandated retail price. Only CENTRAL stock has a real shop-side buy cost.
  const isAgency = /agency/i.test(f.stockType || "");
  const patch = {};
  const cost = num(f.b2b);
  const ean = cleanEan(f.ean);
  if (p.agencyStock !== isAgency) patch.agencyStock = isAgency;
  if (isAgency) {
    // Undo any cost a prior run wrote from an agency B2B — it is not the shop's.
    if (p.costPrice !== null) patch.costPrice = null;
  } else if (cost !== null && p.costPrice !== cost) {
    patch.costPrice = cost; costSet++;
  }
  if (ean && p.gtin !== ean) { patch.gtin = ean; eanSet++; }
  if (Object.keys(patch).length) {
    if (!DRY) await db.product.update({ where: { id: p.id }, data: patch });
    enriched++;
  }

  // 2. observe the agency retail price
  const agency = num(f.b2cAgency);
  if (agency !== null) {
    obsRows.push({
      productId: p.id, sourceId: SOURCE_ID, price: agency,
      deliveryCost: 0, // agency price is delivered-inclusive under the CIH model
      inStock: /in stock/i.test(f.stockSouth || "") || /in stock/i.test(f.stockTank || ""),
      includesVat: true, sourceUrl: "",
      matchConfidence: 1, // exact model-number match against the authorised feed
      status: "ok", note: `CIH feed${f.endOfLife === "Yes" ? " (end of life)" : ""}`,
      observedAt: now,
    });
    observed++;
    if (p.priceNow && Math.abs(agency - p.priceNow) >= 1) {
      gaps++;
      const diff = +(agency - p.priceNow).toFixed(2);
      if (Math.abs(diff) >= 100) big.push({ code: p.productCode, ours: p.priceNow, cih: agency, diff, cost });
    }
  }
}

if (!DRY && obsRows.length) {
  for (let i = 0; i < obsRows.length; i += 500) await db.priceObservation.createMany({ data: obsRows.slice(i, i + 500) });
  await db.priceSource.update({ where: { id: SOURCE_ID }, data: { lastRunAt: now, lastRunStatus: `${observed} observed, ${gaps} differ` } });
}

console.log(`matched products : ${matched}`);
console.log(`enriched         : ${enriched}  (cost set ${costSet}, ean set ${eanSet})${DRY ? " — not written" : ""}`);
console.log(`observations     : ${observed}  (${gaps} differ from our price)${DRY ? " — not written" : ""}`);
big.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
console.log(`\nlargest gaps (>= £100):`);
for (const g of big.slice(0, 15)) {
  const loss = g.diff > 0 ? "" : (g.cost && g.ours < g.cost ? "  ⚠ BELOW COST" : "");
  console.log(`  ${g.code.padEnd(18)} ours £${g.ours}  cih £${g.cih}  (${g.diff > 0 ? "+" : ""}${g.diff})${loss}`);
}
await db.$disconnect();
console.log(`\n${DRY ? "DRY RUN — nothing written." : "✓ Done. Review and apply in /admin/price-watch."}`);
