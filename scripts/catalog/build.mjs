/**
 * Build data/{products,categories,brands}.json from data/catalog-raw.json.
 *
 * Source catalogues (1,603 products):
 *   bosch   836  — bosch-home.co.uk
 *   neff    446  — neff-home.com
 *   ruislip 321  — scraped appliance range
 *
 * Run: npm run catalog:build
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TREE, LEAF, classify } from "./taxonomy.mjs";

const ROOT = process.cwd();
const DATA = join(ROOT, "data");
const raw = JSON.parse(readFileSync(join(DATA, "catalog-raw.json"), "utf8"));

/* ---------------- brands ---------------- */
// Source brand strings are inconsistent: "BOSCH", "Neff home appliances GB",
// and ruislip uses the folder name, which truncates at the first word
// ("Fisher" -> Fisher & Paykel, "Russell" -> Russell Hobbs).
const BRAND_FIX = {
  BOSCH: "Bosch",
  "NEFF HOME APPLIANCES GB": "Neff",
  NEFF: "Neff",
  FISHER: "Fisher & Paykel",
  RUSSELL: "Russell Hobbs",
  NUTRIBULLET: "Nutribullet",
  AEG: "AEG",
  LG: "LG",
  "FISHER & PAYKEL": "Fisher & Paykel",
};
const titleCase = (s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
function cleanBrand(r) {
  const b = (r.brand || "").trim();
  const up = b.toUpperCase();
  if (BRAND_FIX[up]) return BRAND_FIX[up];
  if (/^neff/i.test(b)) return "Neff";
  if (b === b.toUpperCase() && b.length > 3) return titleCase(b);
  return b || "Unbranded";
}

const slugify = (s) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/* ---------------- text cleanup ---------------- */
// Every source prefixes the title with the product code; ruislip additionally
// carries CSV escaping artifacts ('"LG 43… 43"" 4K…"').
function stripLeadingCode(text, model, folder) {
  let d = text.trim();
  const first = d.split(/\s+/)[0] || "";
  if (first.length >= 4) {
    for (const c of [model, folder].filter(Boolean)) {
      if (c.toUpperCase().startsWith(first.toUpperCase().replace(/[",]/g, ""))) {
        d = d.slice(first.length).trim();
        break;
      }
    }
  }
  return d;
}
function unquote(d) {
  let s = d.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length > 1) s = s.slice(1, -1);
  return s.replace(/""/g, '"').trim();
}
function stripBrandAndModel(text, brand, model) {
  let d = text;
  for (let i = 0; i < 3; i++) {
    const before = d;
    if (brand && d.toLowerCase().startsWith(brand.toLowerCase() + " ")) d = d.slice(brand.length).trim();
    if (model && d.toUpperCase().startsWith(model.toUpperCase() + " ")) d = d.slice(model.length).trim();
    d = d.replace(/^[-–—•:,\s]+/, "");
    if (d === before) break;
  }
  return d.trim();
}
const tidy = (s) => s.replace(/\s+/g, " ").replace(/[-–—•,\s]+$/, "").trim();

/** Cut at a word boundary and never leave a dangling dash: "… AirFry Oven - " */
function clip(s, max) {
  if (s.length <= max) return tidy(s);
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return tidy(at > max * 0.6 ? cut.slice(0, at) : cut) + "…";
}

/* ---------------- availability ---------------- */
// NOTE: these values come from the manufacturer sites, not from the shop's own
// stock system. The UI never states stock as fact — every product says "call to
// confirm" — so this is a hint for filtering, not a promise.
function normAvail(a) {
  const s = (a || "").toLowerCase();
  if (s.includes("in stock")) return "in_stock";
  if (s.includes("limited")) return "limited";
  if (s.includes("await") || s.includes("back order")) return "awaiting_stock";
  if (s.includes("unavailable") || s.includes("discontinued")) return "unavailable";
  return "call_to_confirm";
}

/* ---------------- merge cross-feed duplicates ----------------
 * The same appliance can arrive from the manufacturer feed AND the retailer
 * feed (e.g. Bosch KFD96APEA in both). Same brand + same model = one product;
 * listing it twice is a bug, not completeness. Merge into the richest record.
 *
 * NOTE: this deliberately does NOT merge Bosch/Neff twins of a shared BSH part
 * number — those are sold as different branded SKUs and customers search by
 * their own appliance's brand, so both stay.
 */
function mergeDupes(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${cleanBrand(r)}|${(r.model || r.folder).trim().toUpperCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const merged = [];
  let collapsed = 0;
  for (const [, g] of groups) {
    if (g.length === 1) { merged.push(g[0]); continue; }
    // richest = most specs, then most images, then has a price
    const best = [...g].sort((a, b) =>
      Object.keys(b.specs || {}).length - Object.keys(a.specs || {}).length ||
      b.localImages.length - a.localImages.length ||
      Number(b.price !== null) - Number(a.price !== null)
    )[0];
    const withPrice = g.find((x) => x.price !== null);
    const withImages = [...g].sort((a, b) => b.localImages.length - a.localImages.length)[0];
    const withDesc = [...g].sort((a, b) => (b.description || "").length - (a.description || "").length)[0];
    merged.push({
      ...best,
      price: best.price ?? withPrice?.price ?? null,
      localImages: best.localImages.length ? best.localImages : withImages.localImages,
      description: best.description || withDesc.description,
      availability: best.availability || g.find((x) => x.availability)?.availability || "",
      mergedFrom: g.map((x) => x.key),
    });
    collapsed += g.length - 1;
  }
  console.log(`Merged ${collapsed} duplicate listings (same brand + model from two feeds) -> ${merged.length} unique products`);
  return merged;
}

/* ---------------- build products ---------------- */
const products = [];
const errors = [];
const usedSlugs = new Map();

for (const r of mergeDupes(raw)) {
  let cls;
  try { cls = classify(r); } catch (e) { errors.push(e.message); continue; }
  const meta = LEAF.get(cls.leaf);
  if (!meta) { errors.push(`bad leaf ${cls.leaf} for ${r.key}`); continue; }

  const brand = cleanBrand(r);
  const code = (r.model || r.folder).trim();

  const base = r.source === "ruislip" ? r.description : r.name;
  let title = tidy(stripBrandAndModel(unquote(stripLeadingCode(base, r.model, r.folder)), brand, code));
  if (!title || title.length < 3) title = tidy(unquote(base)) || `${brand} ${code}`;

  // slug must be unique across sources: 224 BSH part numbers exist under both
  // bosch and neff, so model alone is not a key.
  let slug = slugify(`${brand}-${code}`);
  if (usedSlugs.has(slug)) {
    const n = usedSlugs.get(slug) + 1;
    usedSlugs.set(slug, n);
    slug = `${slug}-${n}`;
  } else usedSlugs.set(slug, 1);

  const gallery = r.localImages.length ? r.localImages : (r.remoteImage ? [r.remoteImage] : []);
  const specifications = r.specs && typeof r.specs === "object"
    ? Object.entries(r.specs).map(([label, value]) => ({ label, value: String(value) })).filter((s) => s.value && s.value !== "null")
    : [];

  const priceNow = typeof r.price === "number" ? r.price : null;

  products.push({
    id: slug,
    sourceUrl: r.source_url,
    oldUrl: "",
    newSlug: `/products/${slug}`,
    title,
    brand,
    productCode: code,
    category: meta.topName,
    subcategory: meta.leafName,
    breadcrumbs: [meta.topName, meta.leafName],
    priceNow,
    priceWas: null,
    saving: null,
    currency: r.currency || "GBP",
    availability: r.availability || "",
    availabilityNormalised: normAvail(r.availability),
    warranty: "",
    shortDescription: tidy(unquote(r.description)).slice(0, 300),
    descriptionHtml: "",
    descriptionText: tidy(unquote(r.description)),
    specifications,
    features: [],
    energyLabelUrl: "",
    image: gallery[0] || "",
    gallery,
    relatedProducts: [],
    services: [],
    deliveryNotes: "",
    // No "| Euronics Ruislip" suffix here — the root layout's title template
    // appends the trading name, and baking it in produced "… | Euronics R | Euronics Ruislip".
    seoTitle: clip(`${brand} ${title}`, 68),
    seoDescription: clip(`${brand} ${code} — ${title}. Call 0208 864 5763 to confirm price, availability and delivery.`, 300),
    meta: { source: r.source, leaf: meta.leafId, how: cls.how },
    scrapedAt: "",
  });
}

if (errors.length) {
  console.error(`\n${errors.length} CLASSIFICATION ERRORS — refusing to write:`);
  for (const e of errors.slice(0, 40)) console.error("  " + e);
  process.exit(1);
}

/* ---------------- categories ---------------- */
const countLeaf = (name) => products.filter((p) => p.subcategory === name).length;
const countTop = (name) => products.filter((p) => p.category === name).length;

// Pick the dearest product that has a photo — the flagship model makes a far
// better category tile than whatever happens to sort first (a test strip).
const hero = (pred) =>
  products.filter((p) => pred(p) && p.image && p.priceNow !== null)
    .sort((a, b) => b.priceNow - a.priceNow)[0]?.image
  || products.find((p) => pred(p) && p.image)?.image
  || "";

const categories = [];
for (const t of TREE) {
  categories.push({
    id: t.id, name: t.name, slug: `/${t.id}`, sourceUrl: "", parentCategory: "",
    children: t.children.map((c) => c.id), description: t.blurb,
    productCount: countTop(t.name),
    image: hero((p) => p.category === t.name),
    seoTitle: t.name,
    seoDescription: t.blurb,
  });
  for (const c of t.children) {
    categories.push({
      id: c.id, name: c.name, slug: `/${t.id}/${c.id}`, sourceUrl: "", parentCategory: t.id,
      children: [], description: "",
      productCount: countLeaf(c.name),
      image: hero((p) => p.subcategory === c.name),
      seoTitle: c.name,
      seoDescription: `${c.name} at Euronics Ruislip. Call 0208 864 5763 to confirm availability.`,
    });
  }
}

/* ---------------- brands ---------------- */
// Real logos harvested from the client's own site live in data/brand-logos.json
// (see scripts/catalog/fetch-brand-logos.mjs); merge them so rebuilds keep them.
let brandLogos = {};
try { brandLogos = JSON.parse(readFileSync(join(DATA, "brand-logos.json"), "utf8")); } catch {}
const brandNames = [...new Set(products.map((p) => p.brand))].sort((a, b) => a.localeCompare(b));
const brands = brandNames.map((name) => ({
  id: slugify(name), name, slug: slugify(name), sourceUrl: "",
  logo: brandLogos[slugify(name)] || "",
  productCount: products.filter((p) => p.brand === name).length,
}));

/* ---------------- write + report ---------------- */
writeFileSync(join(DATA, "products.json"), JSON.stringify(products, null, 1));
writeFileSync(join(DATA, "categories.json"), JSON.stringify(categories, null, 1));
writeFileSync(join(DATA, "brands.json"), JSON.stringify(brands, null, 1));

console.log(`\nBUILT ${products.length} products (raw ${raw.length}) — ${raw.length - products.length} dropped`);
console.log(`Brands: ${brands.length}   Categories: ${categories.length}`);
console.log(`Unique slugs: ${new Set(products.map((p) => p.id)).size}`);
console.log(`With price: ${products.filter((p) => p.priceNow !== null).length}   With image: ${products.filter((p) => p.image).length}   With specs: ${products.filter((p) => p.specifications.length).length}`);
console.log("\nBy category:");
for (const t of TREE) {
  console.log(`  ${t.name.padEnd(26)} ${String(countTop(t.name)).padStart(4)}`);
  for (const c of t.children) console.log(`     ${c.name.padEnd(34)} ${String(countLeaf(c.name)).padStart(4)}`);
}
console.log("\nBy source:");
for (const s of ["bosch", "neff", "ruislip"]) console.log(`  ${s.padEnd(10)} ${products.filter((p) => p.meta.source === s).length}`);
