/**
 * Build the 301 map from the old site to this one.
 *
 * The cutover is the one irreversible step of the migration: a URL that is
 * live today and has no redirect tomorrow returns 404 and loses its ranking.
 * So every URL in data/old-site-urls.jsonl — the crawl of the old site, every
 * internal link it exposes — must land on a real page here. Never the home
 * page as a catch-all: Google reads that as a soft 404.
 *
 *   node scripts/db/with-prod-db.mjs scripts/migration/build-redirects.mjs
 *
 * Products are matched by model code, which the old slugs carry
 * (/bosch-wan28258gb-8kg-1400-spin.../p-7320). The old site keys a product on
 * the p-{id} and serves it under ANY slug, so each redirect matches on the id
 * with the slug as a wildcard — an older slug Google still holds redirects too.
 * A product we do not stock goes to the same brand on the same shelf here if
 * that shelf has stock, else to the shelf, so the visitor lands somewhere
 * useful and Google sees a relevant page, not an empty one.
 *
 * The August scrape (data/redirects.json, written by scripts/scraper) is a
 * second source of codes: its destinations are all dead — the catalogue was
 * rebuilt since — but the scraper read each product's code off the old page
 * and put it in the slug, which rescues an old URL whose own slug has none
 * (/bosch-9-kg-1400-spin/p-8741 is WAN28259GB).
 *
 * Writes data/old-site-redirects.json, read by next.config.mjs. Not
 * data/redirects.json: the scraper writes that and would clobber this.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const IN = path.join(ROOT, "data", "old-site-urls.jsonl");
const OUT = path.join(ROOT, "data", "old-site-redirects.json");
const AUGUST = path.join(ROOT, "data", "redirects.json");

// Old listing path -> our category id. The old site's own names, where they
// differ from ours (its "refrigerators" is our "fridges"; its "dishwashing"
// is our "dishwashers"). Anything not here is reported, not guessed.
const CATEGORY = {
  "/laundry": "laundry",
  "/laundry/washing-machines": "washing-machines",
  "/laundry/tumble-dryers": "tumble-dryers",
  "/laundry/washer-dryers": "washer-dryers",
  "/refrigeration": "refrigeration",
  "/refrigeration/fridge-freezers": "fridge-freezers",
  "/refrigeration/american-style-fridge-freezers": "american-fridge-freezers",
  "/refrigeration/refrigerators": "fridges",
  "/refrigeration/freezers": "freezers",
  "/dishwashing": "dishwashers",
  "/dishwashing/full-size-dishwashers": "dishwashers",      // the old shelf mixes built-in and freestanding
  "/dishwashing/slimline-dishwashers": "dishwashers",   // slimline can be either; the parent is honest
  "/cooking": "cooking",
  "/cooking/cookers": "cookers",
  "/cooking/ovens": "ovens",
  "/cooking/hobs": "hobs",
  "/cooking/microwaves": "microwaves",
  "/cooking/cooker-hoods": "cooker-hoods",
  "/floorcare": "floorcare",
  "/floorcare/upright-vacuum-cleaners": "vacuum-cleaners",
  "/floorcare/cordless-vacuum-cleaners": "cordless-vacuums",
  "/small-appliances": "small-appliances",
  "/small-appliances/kettles": "kettles",
  "/small-appliances/toasters": "toasters",
  "/small-appliances/coffee-machines": "coffee-machines",
  "/tv-blu-ray--audio/televisions": "televisions",   // 404 on the old site itself, but its nav still links it
};

// Old page -> ours. The promotions and the gift-card page have no equivalent;
// the shop floor is the nearest honest landing for a promotion.
const PAGE = {
  "/about-us": "/about",
  "/about-euronics": "/about",
  "/search": "/products",
  "/contact-us": "/contact",
  "/service-and-support": "/delivery-services",
  "/service-and-support/delivery-returns": "/delivery-services",
  "/service-and-support/terms-and-conditions": "/terms",
  "/service-and-support/privacy-and-cookies": "/privacy",
  "/news-and-events": "/",
  "/love2shop": "/",
};
const PROMOTION = /^\/promotions\/\d+$/;

// A product first seen on the home page or a promotion has no shelf to fall
// back to, but its slug names the appliance. Order matters: "washer-dryer"
// before "dryer", "american" before "fridge-freezer" before "freezer".
const HINT = [
  [/washer-dryer/, "washer-dryers"], [/dryer/, "tumble-dryers"], [/washing-machine|\d-?kg-1[024]00-spin|spin/, "washing-machines"],
  [/american/, "american-fridge-freezers"], [/fridge-freezer/, "fridge-freezers"], [/freezer/, "freezers"], [/fridge|refrigerator|larder/, "fridges"],
  [/dishwasher/, "dishwashers"], [/cooker-hood|extractor|hood/, "cooker-hoods"], [/oven/, "ovens"], [/hob/, "hobs"],
  [/microwave/, "microwaves"], [/cooker/, "cookers"], [/vacuum/, "vacuum-cleaners"], [/kettle/, "kettles"],
  [/toaster/, "toasters"], [/coffee/, "coffee-machines"], [/television|tv/, "televisions"],
];

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// -------------------------------------------------------------- catalogue --
const { PrismaClient } = await import(`file:///${ROOT.replace(/\\/g, "/")}/.prisma-pg/client/index.js`);
const db = new PrismaClient();
const products = await db.product.findMany({ where: { isVisible: true }, select: { slug: true, productCode: true, brand: true, category: true, subcategory: true } });
const categories = await db.category.findMany({ select: { id: true, name: true } });
const brands = await db.brand.findMany({ select: { name: true } });
await db.$disconnect();

const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
// Longest code first: a short code can sit inside a longer one.
const byCode = products.filter((p) => norm(p.productCode).length >= 5)
  .sort((a, b) => norm(b.productCode).length - norm(a.productCode).length);
// "brand|shelf name" -> products. /products?cat= matches a product's category
// OR its subcategory (ProductBrowser), so a shelf is counted under both names.
const shelfCount = new Map();
for (const p of products) for (const shelf of new Set([p.category, p.subcategory])) {
  const k = `${p.brand}|${shelf}`; shelfCount.set(k, (shelfCount.get(k) || 0) + 1);
}
// Old slugs lead with the brand, hyphenated: /russell-hobbs-…, /lg-electronics-…
const brandBySlug = new Map(brands.map((b) => [b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), b.name]));
brandBySlug.set("lg-electronics", "LG");

// What the August scrape called each product, by old id — for the code in it.
const august = new Map();
if (fs.existsSync(AUGUST)) for (const r of JSON.parse(fs.readFileSync(AUGUST, "utf8"))) {
  const id = (r.oldUrl || "").match(/\/p-(\d+)$/);
  if (id && r.newUrl) august.set(id[1], r.newUrl.replace(/^\/products\//, ""));
}

// ------------------------------------------------------------------ build --
const rows = fs.readFileSync(IN, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const out = [];
const report = { product: 0, productByCode: 0, productToBrandShelf: 0, productToShelf: 0, category: 0, brand: 0, page: 0, unmapped: [] };
const fallbacks = [];
const matched = [];

for (const r of rows) {
  const u = r.url;
  if (r.kind === "home") continue;

  if (r.kind === "product") {
    report.product++;
    const id = u.match(/\/p-(\d+)$/)[1];
    const slug = u.slice(1, u.lastIndexOf("/"));
    const source = `/:slug/p-${id}`;
    const tokens = slug.split("-");
    const brand = brandBySlug.get(`${tokens[0]}-${tokens[1]}`) || brandBySlug.get(tokens[0]) || null;
    const hay = [norm(slug), norm(august.get(id))].filter(Boolean);
    // A code found in the slug must belong to the slug's own brand: a short
    // code can sit inside another maker's slug by coincidence. The August
    // scrape wrote UK codes without their GB suffix (WAN28259 for WAN28259GB),
    // so a GB code also matches on its stem.
    const sameBrand = (p) => !brand || p.brand === brand;
    const stem = (c) => (c.length >= 9 && c.endsWith("GB") ? c.slice(0, -2) : c);
    const hit = byCode.find((p) => sameBrand(p) && hay.some((h) => h.includes(norm(p.productCode))))
      || byCode.find((p) => sameBrand(p) && hay.some((h) => h.includes(stem(norm(p.productCode)))));
    if (hit) { out.push({ source, destination: `/products/${hit.slug}` }); report.productByCode++; matched.push({ old: u, to: hit }); continue; }

    // Not stocked. Same brand on the same shelf if that shelf has stock, else the shelf.
    const catId = CATEGORY[r.foundOn] || (HINT.find(([re]) => re.test(slug)) || [])[1];
    let destination;
    if (catId && brand && shelfCount.get(`${brand}|${catName[catId]}`) > 0) {
      destination = `/products?brand=${encodeURIComponent(brand)}&cat=${encodeURIComponent(catName[catId])}`;
      report.productToBrandShelf++;
    } else if (catId) {
      destination = `/categories/${catId}`;
      report.productToShelf++;
    } else {
      report.unmapped.push(u); continue;
    }
    out.push({ source, destination });
    fallbacks.push({ old: u, to: destination });
    continue;
  }

  // Not a product: a shelf, a brand, or a page — looked up by path, whatever
  // the crawler called it. The old site's /cooking is a shelf; its
  // /service-and-support/delivery-returns is a page.
  if (CATEGORY[u]) { out.push({ source: u, destination: `/categories/${CATEGORY[u]}` }); report.category++; continue; }
  // /brands/Hotpoint is handled by middleware.ts, which lowercases the path.
  // A static redirect here would loop: next.config sources match
  // case-insensitively, so "/brands/Hotpoint" also matches "/brands/hotpoint".
  if (/^\/brands\/[^/]+$/.test(u)) { report.brand++; continue; }

  const page = PAGE[u] || (PROMOTION.test(u) ? "/products" : null);
  if (!page) { report.unmapped.push(u); continue; }
  out.push({ source: u, destination: page }); report.page++;
}

// A source that would be read as a pattern rather than a path is a bug, not a redirect.
const bad = out.filter((r) => /[()*+?:]/.test(r.source.replace(/^\/:slug\//, "/")));
if (bad.length) { console.error("sources with pattern characters:", bad); process.exit(1); }
if (report.unmapped.length) { console.error("UNMAPPED — add these to CATEGORY or PAGE before shipping:", report.unmapped); process.exit(1); }

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`${out.length} redirects written to data/old-site-redirects.json`);
console.log(`  products ${report.product}: ${report.productByCode} matched by code, ${report.productToBrandShelf} to the brand's shelf, ${report.productToShelf} to the shelf`);
console.log(`  categories ${report.category}, pages ${report.page}; ${report.brand} brand pages left to middleware.ts`);
// Every code match, for the eye: the old slug beside the product it lands on.
console.log(`
matched by code:`);
for (const m of matched) console.log(`  ${m.old}
      -> /products/${m.to.slug}  [${m.to.brand} ${m.to.productCode}]`);
if (fallbacks.length) {
  console.log(`\nnot stocked here — landing on the nearest shelf (review these):`);
  for (const f of fallbacks) console.log(`  ${f.old}\n      -> ${f.to}`);
}
