/**
 * Reconcile our catalogue against the LIVE Euronics national range.
 *
 * Answers Sachin's two questions with measured numbers, not estimates:
 *   1. PRODUCTS  — how much of the Euronics range do we carry, and what's missing?
 *   2. PRICES    — where our shelf price differs from Euronics' current price.
 *
 * Two modes:
 *   node scripts/catalog/reconcile-euronics.mjs            coverage report only
 *                                                          (reads the sitemap, no
 *                                                           product pages, no writes)
 *   node scripts/catalog/reconcile-euronics.mjs --prices [--brand <name>] [--limit N]
 *                                                          also fetch current Euronics
 *                                                          prices for MATCHED products
 *                                                          and record them as
 *                                                          PriceObservations under the
 *                                                          "euronics" source.
 *
 * SAFETY: like every ingest path, this only OBSERVES. It never writes
 * Product.priceNow — adoption still runs through lib/price-watch/guards.ts and a
 * human at /admin/price-watch. Exact code→model matches are confidence 1.0;
 * suffix-stripped matches are 0.8 so the guards HOLD them for review.
 *
 * Match key: Euronics SKUs are <BRAND-CODE><MODEL> (BEKEDP503W = BEK + EDP503W).
 * The brand code is LEARNED per brand from the common prefix of its SKUs, then
 * stripped to recover the model, which joins to our productCode. Brand must agree.
 *
 * Runs against whatever DATABASE_URL / PRISMA_CLIENT_DIR points at (local or prod).
 */
import { createRequire } from "module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const SOURCE_ID = "euronics";
const SITEMAP = "https://www.euronics.co.uk/sitemap.xml";
const UA = "JyotsnaElectricalBot/1.0 (+catalogue reconciliation; contact rohith@kroneuszerotrust.com)";
const args = process.argv.slice(2);
const WITH_PRICES = args.includes("--prices");
const brandArg = (args[args.indexOf("--brand") + 1] || "").toLowerCase();
const limitArg = Number(args[args.indexOf("--limit") + 1]) || 0;

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, timeoutMs = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: ac.signal });
    return r.ok ? await r.text() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

/** All product URLs from the Euronics sitemap index. */
async function euronicsUrls() {
  const index = await get(SITEMAP);
  if (!index) throw new Error("could not fetch the Euronics sitemap index");
  const maps = [...index.matchAll(/<loc>([^<]*Product-en-GBP[^<]*)<\/loc>/g)].map((m) => m[1]);
  const urls = new Set();
  for (const m of maps) {
    const xml = await get(m, 60000);
    if (!xml) continue;
    for (const u of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(u[1]);
    await sleep(300);
  }
  return [...urls];
}

/** Extract price + availability from a product page's JSON-LD. */
function extractPrice(html) {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let product = null;
  const walk = (o) => { if (!o || typeof o !== "object") return; const t = o["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) product = product || o;
    for (const k in o) walk(o[k]); };
  for (const b of blocks) { try { walk(JSON.parse(b)); } catch {} }
  if (!product) return null;
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  if (!offer) return null;
  const price = Number(offer.price ?? offer.lowPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  return { price, inStock: /InStock/i.test(String(offer.availability || "")) };
}

const db = new PrismaClient();

// 1. Euronics range
const urls = await euronicsUrls();
const euro = [];
for (const u of urls) {
  const m = u.match(/\/catalogue\/(.+?)\/([^/]+)\/p\/([A-Za-z0-9._-]+)$/);
  if (!m) continue;
  euro.push({ url: u, cat: m[1].split("/")[0], brandSlug: m[2].split("-")[0].toLowerCase(), sku: norm(m[3]) });
}
console.log(`Euronics range: ${euro.length} products`);

// Learn each brand's SKU prefix, then index by recovered model
const byBrandSku = new Map();
for (const e of euro) { if (!byBrandSku.has(e.brandSlug)) byBrandSku.set(e.brandSlug, []); byBrandSku.get(e.brandSlug).push(e.sku); }
const prefixOf = new Map();
for (const [b, skus] of byBrandSku) {
  if (skus.length < 3) continue;
  let p = skus[0];
  for (const s of skus) { let i = 0; while (i < p.length && i < s.length && p[i] === s[i]) i++; p = p.slice(0, i); if (!p) break; }
  const alpha = (p.match(/^[A-Z]+/) || [""])[0].slice(0, 5);
  if (alpha.length >= 2) prefixOf.set(b, alpha);
}
const euroByModel = new Map();
for (const e of euro) {
  const pre = prefixOf.get(e.brandSlug);
  const model = pre && e.sku.startsWith(pre) ? e.sku.slice(pre.length) : e.sku;
  if (model.length >= 4 && !euroByModel.has(model)) euroByModel.set(model, e);
}

// 2. Match our catalogue
const prods = await db.product.findMany({ where: { isVisible: true }, select: { id: true, productCode: true, brand: true, priceNow: true } });
const brandAgrees = (ourBrand, brandSlug) => { const b = ourBrand.toLowerCase().replace(/[^a-z]/g, ""); return b.startsWith(brandSlug.slice(0, 4)) || brandSlug.startsWith(b.slice(0, 4)); };

const matched = [];
for (const p of prods) {
  const c = norm(p.productCode);
  let e = euroByModel.get(c); let conf = 1.0;
  if (!e) { for (let k = 2; k <= 4 && !e; k++) { if (c.length - k >= 5) { e = euroByModel.get(c.slice(0, c.length - k)); if (e) conf = 0.8; } } }
  if (e && brandAgrees(p.brand, e.brandSlug)) matched.push({ p, e, conf });
}

const ourSkuSet = new Set(matched.map((m) => m.e.sku));
const missing = euro.filter((e) => !ourSkuSet.has(e.sku));
console.log(`\n=== COVERAGE ===`);
console.log(`Euronics range           : ${euro.length}`);
console.log(`We carry (matched)       : ${matched.length}  (${((matched.length / euro.length) * 100).toFixed(1)}% of the range)`);
console.log(`In Euronics, NOT on our site: ${missing.length}`);

// Missing by brand
const missBrand = new Map();
for (const e of missing) missBrand.set(e.brandSlug, (missBrand.get(e.brandSlug) || 0) + 1);
console.log(`\nBIGGEST GAPS (Euronics products we don't carry, by brand):`);
for (const [b, n] of [...missBrand].sort((a, z) => z[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(4)}  ${b}`);

writeFileSync("euronics-coverage.json", JSON.stringify({
  generatedFor: "reconcile-euronics",
  euronicsRange: euro.length, matched: matched.length, missing: missing.length,
  missingByBrand: Object.fromEntries([...missBrand].sort((a, z) => z[1] - a[1])),
  missingSample: missing.slice(0, 200).map((e) => ({ sku: e.sku, brand: e.brandSlug, cat: e.cat, url: e.url })),
}, null, 2));
console.log(`\nfull coverage report written to euronics-coverage.json`);

// 3. Prices (opt-in)
if (WITH_PRICES) {
  let pool = matched;
  if (brandArg) pool = pool.filter((m) => m.p.brand.toLowerCase().includes(brandArg));
  if (limitArg) pool = pool.slice(0, limitArg);
  console.log(`\n=== PRICES === fetching ${pool.length} Euronics pages (~1/sec)…`);
  const now = new Date();
  const obs = []; let fetched = 0, priced = 0, gaps = 0; const big = [];
  for (const m of pool) {
    const html = await get(m.e.url, 25000);
    fetched++;
    const pr = html ? extractPrice(html) : null;
    if (!pr) { obs.push({ productId: m.p.id, sourceId: SOURCE_ID, price: null, deliveryCost: null, inStock: null, includesVat: true, sourceUrl: m.e.url, matchConfidence: m.conf, status: "parse_failed", note: "no price in JSON-LD", observedAt: now }); await sleep(1000); continue; }
    priced++;
    obs.push({ productId: m.p.id, sourceId: SOURCE_ID, price: pr.price, deliveryCost: null, inStock: pr.inStock, includesVat: true, sourceUrl: m.e.url, matchConfidence: m.conf, status: "ok", note: "euronics.co.uk", observedAt: now });
    if (m.p.priceNow != null && Math.abs(pr.price - m.p.priceNow) >= 1) { gaps++; const diff = +(pr.price - m.p.priceNow).toFixed(2); if (Math.abs(diff) >= 50) big.push({ code: m.p.productCode, ours: m.p.priceNow, euro: pr.price, diff }); }
    await sleep(1000);
  }
  for (let i = 0; i < obs.length; i += 500) await db.priceObservation.createMany({ data: obs.slice(i, i + 500) });
  await db.priceSource.update({ where: { id: SOURCE_ID }, data: { lastRunAt: now, lastRunStatus: `${priced} priced, ${gaps} differ` } });
  console.log(`fetched ${fetched}, priced ${priced}, differ from our price ${gaps}`);
  big.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  console.log(`\nlargest price gaps (>= £50):`);
  for (const g of big.slice(0, 15)) console.log(`  ${g.code.padEnd(16)} ours £${String(g.ours).padEnd(9)} euronics £${String(g.euro).padEnd(9)} (${g.diff > 0 ? "+" : ""}${g.diff})`);
  console.log(`\n✓ observations written — review and apply at /admin/price-watch`);
}

await db.$disconnect();
