/**
 * Bring the catalogue into line with the Euronics national range.
 *
 *   node scripts/catalog/import-euronics-range.mjs --dry-run [--limit N]
 *   node scripts/catalog/import-euronics-range.mjs                        (full sync)
 *   node scripts/catalog/import-euronics-range.mjs --category laundry,dishwashers
 *
 * The client is a Euronics member, so the group's range is what he can sell and
 * the group's price is the price he shows. One pass does both halves:
 *
 *   product we already hold  -> price corrected to the current Euronics price
 *   product we do not hold   -> created, priced from Euronics
 *
 * FOUR RULES THAT MATTER MORE THAN THE SYNC ITSELF
 *
 *  1. A price the owner set BY HAND is never overwritten. If "priceNow" is in
 *     adminOverrideFields he has already decided, and this run leaves it alone —
 *     the same rule the re-scrape has always honoured.
 *  2. Newly created products land as availabilityNormalised = "call_to_confirm".
 *     He has not said he holds stock, so the site must not imply it — and it keeps
 *     them out of the Google feed, which needs a stock status he can stand behind.
 *  3. Call-for-price categories are skipped entirely. Those must never carry a
 *     published price, whatever the source says.
 *  4. Images are referenced at their Euronics URL, never rehosted.
 *
 * Resumable and safe to re-run: it compares before writing, so a second run is a
 * no-op for anything already in step. Unclassifiable products are reported and
 * skipped, never guessed at.
 */
import { createRequire } from "module";
import { classify, LEAF } from "./taxonomy.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const args = process.argv.slice(2);
const argNum = (n, d) => { const i = args.indexOf(n); return i >= 0 ? (Number(args[i + 1]) || d) : d; };
const DRY = args.includes("--dry-run");
const LIMIT = argNum("--limit", 0);
const DELAY_MS = argNum("--delay", 850);
// Top-level Euronics departments to restrict this run to. The owner's core
// ranges are worth completing to 100% on their own, without paying for a walk
// of all ~4,800 pages to reach them.
const CATEGORIES = (args.indexOf("--category") >= 0 ? (args[args.indexOf("--category") + 1] || "") : "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const SITEMAP = "https://www.euronics.co.uk/sitemap.xml";
const UA = "JyotsnaElectricalBot/1.0 (+catalogue sync, Euronics member; contact rohith@kroneuszerotrust.com)";
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

async function get(url, timeoutMs = 25000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try { const r = await fetch(url, { headers: { "User-Agent": UA }, signal: ac.signal }); return r.ok ? await r.text() : null; }
  catch { return null; } finally { clearTimeout(t); }
}

function extract(html) {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let p = null;
  const walk = (o) => { if (!o || typeof o !== "object") return; const t = o["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) p = p || o; for (const k in o) walk(o[k]); };
  // Euronics emits RAW newlines inside JSON-LD string values, which is invalid
  // JSON, and roughly a third of pages in some departments carry one. A control
  // character can only ever be whitespace OUTSIDE a string literal, so blanking
  // them is safe either way, and it is the difference between reading a product
  // and silently not seeing it at all.
  const blankCtrl = (s) => Array.from(s, (c) => (c.charCodeAt(0) < 32 ? " " : c)).join("");
  const lenient = (s) => { try { return JSON.parse(s); } catch { /* repair below */ }
    try { return JSON.parse(blankCtrl(s)); } catch { return null; } };
  for (const b of blocks) { const j = lenient(b); if (j) walk(j); }
  if (!p) return null;
  const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  const price = offer ? Number(offer.price ?? offer.lowPrice) : NaN;
  const img = Array.isArray(p.image) ? p.image[0] : p.image;
  const meta = (n) => (html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i")) || [])[1] || "";
  return {
    title: String(p.name || "").trim(),
    brand: String(typeof p.brand === "object" ? p.brand?.name : p.brand || "").trim(),
    gtin: String(p.gtin13 || p.gtin || p.gtin12 || p.gtin14 || "").replace(/[^0-9]/g, ""),
    description: String(p.description || meta("og:description") || "").trim(),
    image: typeof img === "string" ? img : String(img?.url || ""),
    price: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null,
    inStock: /InStock/i.test(String(offer?.availability || "")),
  };
}

const db = new PrismaClient();

// ---- the Euronics range ----------------------------------------------------
const index = await get(SITEMAP, 40000);
if (!index) { console.error("could not read the Euronics sitemap"); process.exit(1); }
const maps = [...index.matchAll(/<loc>([^<]*Product-en-GBP[^<]*)<\/loc>/g)].map((m) => m[1]);
const urls = new Set();
for (const m of maps) {
  const xml = await get(m, 60000);
  if (xml) for (const u of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(u[1]);
  await sleep(250);
}
let euro = [];
for (const u of urls) {
  const m = u.match(/\/catalogue\/(.+?)\/([^/]+)\/p\/([A-Za-z0-9._-]+)$/);
  if (m) euro.push({ url: u, brandSlug: m[2].split("-")[0].toLowerCase(), sku: norm(m[3]) });
}
if (CATEGORIES.length) {
  // Filter AFTER the full list is built: the brand prefixes below are learned
  // from every SKU a brand has, and narrowing the sample first would learn a
  // wrong prefix and stop products matching what we already hold.
  const before = euro.length;
  euro = euro.filter((e) => CATEGORIES.includes((e.url.split("/catalogue/")[1] || "").split("/")[0]));
  console.log(`--category ${CATEGORIES.join(",")}: ${euro.length} of ${before} Euronics pages`);
}

// Learn each brand's SKU prefix so a SKU reduces to a manufacturer model number.
const byBrand = new Map();
for (const e of euro) { if (!byBrand.has(e.brandSlug)) byBrand.set(e.brandSlug, []); byBrand.get(e.brandSlug).push(e.sku); }
const prefixOf = new Map();
for (const [b, skus] of byBrand) {
  if (skus.length < 3) continue;
  let p = skus[0];
  for (const s of skus) { let i = 0; while (i < p.length && i < s.length && p[i] === s[i]) i++; p = p.slice(0, i); if (!p) break; }
  const alpha = (p.match(/^[A-Z]+/) || [""])[0].slice(0, 5);
  if (alpha.length >= 2) prefixOf.set(b, alpha);
}
const modelOf = (e) => { const pre = prefixOf.get(e.brandSlug); return pre && e.sku.startsWith(pre) ? e.sku.slice(pre.length) : e.sku; };

// ---- what we hold ----------------------------------------------------------
const poaNames = new Set((await db.category.findMany({ where: { priceOnApplication: true }, select: { name: true } })).map((c) => c.name));
const existing = await db.product.findMany({ select: { id: true, productCode: true, slug: true, priceNow: true, category: true, subcategory: true, adminOverrideFields: true } });
const byCode = new Map();
for (const p of existing) byCode.set(norm(p.productCode), p);
const haveSlug = new Set(existing.map((p) => p.slug));

let work = euro;
if (LIMIT) work = work.slice(0, LIMIT);
console.log(`Euronics range: ${euro.length}   we hold: ${existing.length}   processing: ${work.length}${DRY ? "  (dry run)" : ""}\n`);

// ---- sync ------------------------------------------------------------------
let created = 0, repriced = 0, alreadyOk = 0, lockedSkipped = 0, poaSkipped = 0, unclassified = 0, fetchFailed = 0, noPrice = 0;
const priceMoves = [];
const problems = [];

for (const e of work) {
  const model = modelOf(e);
  const mine = byCode.get(model) || byCode.get(e.sku);

  // Fast path: an existing product whose price the owner has fixed by hand.
  if (mine && ((mine.adminOverrideFields) || []).includes?.("priceNow")) { lockedSkipped++; continue; }
  // Never publish a price for a call-for-price product.
  if (mine && (poaNames.has(mine.category) || poaNames.has(mine.subcategory))) { poaSkipped++; continue; }

  const html = await get(e.url);
  if (!html) { fetchFailed++; await sleep(DELAY_MS); continue; }
  const d = extract(html);
  if (!d || !d.title) { fetchFailed++; await sleep(DELAY_MS); continue; }

  if (mine) {
    // ---- already on the site: bring the price into line ----
    if (d.price === null) { noPrice++; }
    else if (mine.priceNow !== null && Math.abs(mine.priceNow - d.price) < 0.01) { alreadyOk++; }
    else {
      if (!DRY) {
        await db.product.update({ where: { id: mine.id },
          // No priceWas/saving: a strike-through here would invent a discount the
          // shop is not actually offering.
          data: { priceNow: d.price, priceWas: null, saving: null, lastScrapedAt: new Date() } });
      }
      repriced++;
      priceMoves.push({ code: mine.productCode, from: mine.priceNow, to: d.price });
    }
    await sleep(DELAY_MS);
    continue;
  }

  // ---- not on the site: create it ----
  let category = "", subcategory = "";
  // Ask the TITLE first, and only fall back to the description. Marketing copy
  // routinely names other appliances ("...activated carbon filter", "...while
  // your coffee brews"), and those words reached a rule before the title did:
  // an LG washing machine was filed as bean-to-cup and a Liebherr wine cooler
  // as cooker-hood-accessories. Both then landed in a call-for-price category
  // and were skipped, so the product never appeared on the site at all.
  const named = `${d.brand} ${d.title}`;
  for (const text of [named, d.description || d.title]) {
    try {
      const { leaf } = classify({ name: named, description: text, source: "euronics", key: e.sku });
      const hit = LEAF.get(leaf);
      if (hit) { category = hit.topName; subcategory = hit.leafName; break; }
    } catch { /* try the description, then give up below */ }
  }
  if (!category) { unclassified++; problems.push(`${e.sku}: unclassifiable — ${d.title.slice(0, 46)}`); await sleep(DELAY_MS); continue; }
  if (poaNames.has(category) || poaNames.has(subcategory)) { poaSkipped++; await sleep(DELAY_MS); continue; }
  if (d.price === null) noPrice++;

  const code = model || e.sku;
  const base = slugify(`${d.brand}-${code}`) || slugify(d.title);
  let slug = base;
  for (let i = 2; haveSlug.has(slug); i++) slug = `${base}-${i}`;
  haveSlug.add(slug); byCode.set(norm(code), { id: "new", productCode: code, priceNow: d.price, adminOverrideFields: [] });

  if (!DRY) {
    await db.product.create({ data: {
      slug, title: d.title, brand: d.brand || "Unbranded", productCode: code, gtin: d.gtin || "",
      category, subcategory, breadcrumbs: [category, subcategory].filter(Boolean),
      priceNow: d.price, priceWas: null, saving: null, currency: "GBP",
      availabilityNormalised: "call_to_confirm", availabilityRaw: "",
      warranty: "", shortDescription: d.description.slice(0, 400), descriptionText: d.description,
      descriptionHtml: "", mainImage: d.image || "", galleryImages: d.image ? [d.image] : [],
      isVisible: true, featured: false,
      sourceUrl: e.url, oldUrl: "", lastScrapedAt: new Date(),
      specifications: [], features: [], relatedProductCodes: [], serviceAddOns: [],
      energyLabelUrl: "", deliveryNotes: "", adminOverrideFields: [],
      seoTitle: `${d.brand} ${d.title}`.trim().slice(0, 68),
      seoDescription: `${d.title}. Call 0208 864 5763 to confirm price, availability and delivery.`.slice(0, 300),
    } });
  }
  created++;
  if ((created + repriced) % 100 === 0) console.log(`  …${created} created, ${repriced} repriced`);
  await sleep(DELAY_MS);
}

console.log(`\n===== EURONICS SYNC ${DRY ? "(DRY RUN — nothing written)" : "COMPLETE"} =====`);
console.log(`  products created      : ${created}`);
console.log(`  prices corrected      : ${repriced}`);
console.log(`  already in sync       : ${alreadyOk}`);
console.log(`  owner-set, left alone : ${lockedSkipped}`);
console.log(`  call-for-price, skipped: ${poaSkipped}`);
console.log(`  no price on page      : ${noPrice}`);
console.log(`  unclassifiable        : ${unclassified}`);
console.log(`  could not fetch       : ${fetchFailed}`);

if (priceMoves.length) {
  priceMoves.sort((a, b) => Math.abs((b.to - (b.from ?? b.to))) - Math.abs((a.to - (a.from ?? a.to))));
  console.log(`\nbiggest price corrections:`);
  for (const m of priceMoves.slice(0, 15)) console.log(`  ${String(m.code).padEnd(16)} £${String(m.from ?? "—").padEnd(9)} -> £${m.to}`);
}
if (problems.length) { console.log(`\nfirst unclassifiable:`); for (const p of problems.slice(0, 10)) console.log(`  ${p}`); }
if (!DRY && (created || repriced)) console.log(`\nNext: npm run rag:build so the chatbot knows the new catalogue.`);
await db.$disconnect();
