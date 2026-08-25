/**
 * Import the Euronics lines we don't yet carry.
 *
 *   node scripts/catalog/import-euronics-range.mjs --dry-run [--limit N]
 *   node scripts/catalog/import-euronics-range.mjs --limit 50
 *   node scripts/catalog/import-euronics-range.mjs            (the whole gap)
 *
 * The client is a Euronics member, so the group's range is what he can sell.
 * reconcile-euronics.mjs measures the gap; this closes it.
 *
 * TWO DELIBERATE CHOICES, because getting these wrong would be worse than the
 * missing products:
 *
 *  1. Everything imported lands as availabilityNormalised = "call_to_confirm".
 *     He has not told us he holds stock of any of these, and claiming otherwise
 *     would put a promise on the site he never made. It also keeps them out of
 *     the Google Shopping feed, which requires a stock status he can stand behind.
 *
 *  2. Images are referenced at the Euronics URL rather than copied. Nothing is
 *     rehosted, so there is no question of appropriating assets, and if a URL
 *     dies the product simply shows no image instead of a broken local file.
 *
 * Resumable: existing productCodes are skipped, so an interrupted run can be
 * re-run and only does what is left. Classification failures are reported and
 * skipped rather than guessed at — a mis-filed product is worse than an absent one.
 */
import { createRequire } from "module";
import { classify, LEAF } from "./taxonomy.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const args = process.argv.slice(2);
const argNum = (n, d) => { const i = args.indexOf(n); return i >= 0 ? (Number(args[i + 1]) || d) : d; };
const DRY = args.includes("--dry-run");
const LIMIT = argNum("--limit", 0);
const DELAY_MS = argNum("--delay", 900);

const SITEMAP = "https://www.euronics.co.uk/sitemap.xml";
const UA = "JyotsnaElectricalBot/1.0 (+catalogue import, Euronics member; contact rohith@kroneuszerotrust.com)";
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

async function get(url, timeoutMs = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try { const r = await fetch(url, { headers: { "User-Agent": UA }, signal: ac.signal }); return r.ok ? await r.text() : null; }
  catch { return null; } finally { clearTimeout(t); }
}

/** Everything we need about one product, from its JSON-LD + og tags. */
function extract(html) {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let p = null;
  const walk = (o) => { if (!o || typeof o !== "object") return; const t = o["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) p = p || o; for (const k in o) walk(o[k]); };
  for (const b of blocks) { try { walk(JSON.parse(b)); } catch { /* malformed block */ } }
  if (!p) return null;
  const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  const price = offer ? Number(offer.price ?? offer.lowPrice) : NaN;
  const img = Array.isArray(p.image) ? p.image[0] : p.image;
  const meta = (name) => (html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i")) || [])[1] || "";
  return {
    title: String(p.name || "").trim(),
    brand: String(typeof p.brand === "object" ? p.brand?.name : p.brand || "").trim(),
    sku: String(p.sku || p.mpn || "").trim(),
    gtin: String(p.gtin13 || p.gtin || p.gtin12 || p.gtin14 || "").replace(/[^0-9]/g, ""),
    description: String(p.description || meta("og:description") || "").trim(),
    image: typeof img === "string" ? img : String(img?.url || ""),
    price: Number.isFinite(price) && price > 0 ? price : null,
  };
}

const db = new PrismaClient();

// ---- 1. the Euronics range -------------------------------------------------
const index = await get(SITEMAP);
if (!index) { console.error("could not read the Euronics sitemap"); process.exit(1); }
const maps = [...index.matchAll(/<loc>([^<]*Product-en-GBP[^<]*)<\/loc>/g)].map((m) => m[1]);
const urls = new Set();
for (const m of maps) {
  const xml = await get(m, 60000);
  if (xml) for (const u of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(u[1]);
  await sleep(250);
}
const euro = [];
for (const u of urls) {
  const m = u.match(/\/catalogue\/(.+?)\/([^/]+)\/p\/([A-Za-z0-9._-]+)$/);
  if (m) euro.push({ url: u, brandSlug: m[2].split("-")[0].toLowerCase(), sku: norm(m[3]) });
}
console.log(`Euronics range: ${euro.length}`);

// Learn each brand's SKU prefix so the SKU can be reduced to a model number.
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

// ---- 2. what we already have ----------------------------------------------
const existing = await db.product.findMany({ select: { productCode: true, slug: true } });
const haveCode = new Set(existing.map((p) => norm(p.productCode)));
const haveSlug = new Set(existing.map((p) => p.slug));

let todo = euro.filter((e) => { const m = modelOf(e); return m.length >= 4 && !haveCode.has(m) && !haveCode.has(e.sku); });
if (LIMIT) todo = todo.slice(0, LIMIT);
console.log(`already carried: ${euro.length - todo.length}   to import: ${todo.length}${DRY ? "  (dry run)" : ""}\n`);

// ---- 3. import -------------------------------------------------------------
let created = 0, noPrice = 0, unclassified = 0, fetchFailed = 0;
const problems = [];

for (const e of todo) {
  const html = await get(e.url, 25000);
  if (!html) { fetchFailed++; await sleep(DELAY_MS); continue; }
  const d = extract(html);
  if (!d || !d.title) { fetchFailed++; problems.push(`${e.sku}: no product data`); await sleep(DELAY_MS); continue; }

  // Classification decides the department. Never guess: an unclassifiable
  // product is reported and skipped, not dumped into a bucket.
  let category = "", subcategory = "";
  try {
    const { leaf } = classify({ name: `${d.brand} ${d.title}`, description: d.description || d.title, source: "euronics", key: e.sku });
    const hit = LEAF.get(leaf);
    if (hit) { category = hit.topName; subcategory = hit.leafName; }
  } catch { /* falls through to the check below */ }
  if (!category) { unclassified++; problems.push(`${e.sku}: could not classify — ${d.title.slice(0, 50)}`); await sleep(DELAY_MS); continue; }

  if (d.price === null) noPrice++;

  const code = modelOf(e) || e.sku;
  let slug = slugify(`${d.brand}-${code}`) || slugify(d.title);
  for (let i = 2; haveSlug.has(slug); i++) slug = `${slugify(`${d.brand}-${code}`)}-${i}`;
  haveSlug.add(slug); haveCode.add(norm(code));

  if (!DRY) {
    await db.product.create({ data: {
      slug, title: d.title, brand: d.brand || "Unbranded", productCode: code,
      gtin: d.gtin || "",
      category, subcategory, breadcrumbs: [category, subcategory].filter(Boolean),
      priceNow: d.price, priceWas: null, saving: null, currency: "GBP",
      // He has not confirmed stock of anything here — say so rather than imply it.
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
  if (created % 50 === 0) console.log(`  …${created} imported`);
  await sleep(DELAY_MS);
}

console.log(`\nimported        : ${created}${DRY ? " (dry run — nothing written)" : ""}`);
console.log(`no price found  : ${noPrice}`);
console.log(`unclassified    : ${unclassified}  (skipped)`);
console.log(`fetch failed    : ${fetchFailed}  (skipped)`);
if (problems.length) { console.log(`\nfirst problems:`); for (const p of problems.slice(0, 15)) console.log(`  ${p}`); }
if (!DRY && created) console.log(`\nNext: npm run rag:build  (so the chatbot knows them), then check /admin/products`);
await db.$disconnect();
