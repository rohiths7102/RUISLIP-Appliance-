/**
 * Create catalogue products for Euronics lines the site does not list yet.
 *
 *   python scripts/catalog/euronics-xlsx-extract.py <file.xlsx> feed2.json   (needs col AH)
 *   node   scripts/catalog/import-missing-from-feed.mjs feed2.json [--dry-run] [--limit N]
 *
 * The daily CIH feed carries 1,295 products; the site listed 370 of them, so
 * ~925 things the shop actually sells were invisible to customers — the
 * owner's loudest complaint ("many products in many categories missing").
 *
 * Everything written here comes from the shop's OWN feed: title (the feed's
 * Identifier column), the mandated retail price, EAN, warranty and stock type.
 * Nothing is invented. Products arrive with:
 *   - availabilityNormalised "call_to_confirm" — the shop's whole model, and
 *     honest for a line whose stock we have not physically confirmed;
 *   - no image (the feed has none) — the storefront already renders a clean
 *     placeholder tile for these, and images can be filled in later;
 *   - agencyStock / costPrice set on the same rule as import-euronics-feed.mjs
 *     (agency B2B is the group's cost basis, never the shop's).
 *
 * Idempotent: a product whose code already exists is skipped, never edited —
 * price updates are the price-watch system's job, not this script's.
 */
import { createRequire } from "module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const DRY = process.argv.includes("--dry-run");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const feedPath = process.argv.find((a) => a.endsWith(".json"));
if (!feedPath) { console.error("usage: import-missing-from-feed.mjs <feed2.json> [--dry-run] [--limit N]"); process.exit(1); }

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
const cleanEan = (v) => { const d = String(v ?? "").replace(/[^0-9]/g, ""); return /^\d{8,14}$/.test(d) ? d : ""; };
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/**
 * Feed category path -> the site's own [category, subcategory].
 * Only paths that map to a real existing subcategory are imported: putting a
 * soundbar in "Accessories" because the path was unrecognised would make the
 * catalogue worse, not bigger. Unmapped paths are reported, not guessed.
 */
const MAP = {
  "tv-and-entertainment > tvs": ["TV & Audio", "Televisions"],
  "home-cinema-soundbars > soundbars": ["TV & Audio", "Soundbars & Speakers"],
  "floorcare > vacuum-cleaners": ["Floorcare", "Vacuum Cleaners"],
  "floorcare > cordless-vacuum-cleaners": ["Floorcare", "Cordless Vacuums"],
  "floorcare > robot-vacuum-cleaners": ["Floorcare", "Robot Vacuums"],
  "floorcare > hard-floor-cleaners": ["Floorcare", "Hard Floor Cleaners"],
  "laundry > washing-machines": ["Laundry", "Washing Machines"],
  "laundry > tumble-dryers": ["Laundry", "Tumble Dryers"],
  "laundry > washer-dryers": ["Laundry", "Washer Dryers"],
  "refrigeration > fridge-freezers": ["Refrigeration", "Fridge Freezers"],
  "refrigeration > american-style-fridge-freezers": ["Refrigeration", "American Style Fridge Freezers"],
  "refrigeration > fridges": ["Refrigeration", "Fridges"],
  "refrigeration > freezers": ["Refrigeration", "Freezers"],
  "refrigeration > wine-coolers": ["Refrigeration", "Wine Coolers"],
  "cooking > ovens": ["Cooking", "Ovens"],
  "cooking > hobs": ["Cooking", "Hobs"],
  "cooking > cookers": ["Cooking", "Cookers"],
  "cooking > microwaves": ["Cooking", "Microwaves"],
  "cooking > cooker-hoods": ["Cooking", "Cooker Hoods & Extractors"],
  "cooking > warming-drawers": ["Cooking", "Warming Drawers"],
  "dishwashers > full-size": ["Dishwashers", "Freestanding Dishwashers"],
  "dishwashers > integrated": ["Dishwashers", "Integrated Dishwashers"],
  "dishwashers > slimline": ["Dishwashers", "Freestanding Dishwashers"],
  "small-appliances > food-preparation": ["Small Appliances", "Food Prep & Kitchen Machines"],
  "small-appliances > kettles": ["Small Appliances", "Kettles"],
  "small-appliances > toasters": ["Small Appliances", "Toasters"],
  "small-appliances > blenders": ["Small Appliances", "Blenders"],
  "small-appliances > air-fryers": ["Small Appliances", "Air Fryers & Multi Cookers"],
  "small-appliances > microwaves": ["Cooking", "Microwaves"],
  "coffee > bean-to-cup": ["Coffee Machines", "Bean to Cup & Espresso"],
  "coffee > pod-machines": ["Coffee Machines", "Tassimo & Pod Machines"],
  "coffee > filter-coffee-machines": ["Coffee Machines", "Filter Coffee Machines"],
  // Second pass: the remaining feed paths, each onto the closest EXISTING
  // subcategory. Where the site has no equivalent shelf (headphones, garden,
  // health & beauty, smart tech) the line is deliberately left out rather than
  // filed somewhere a shopper would never look.
  "cooking > range-cookers": ["Cooking", "Cookers"],
  "small-appliances > small-cooking-appliances": ["Small Appliances", "Air Fryers & Multi Cookers"],
  "small-appliances > drinks-makers": ["Small Appliances", "Blenders"],
  "small-appliances > irons": ["Small Appliances", "Food Prep & Kitchen Machines"],
  "refrigeration > fridges-larder-fridges": ["Refrigeration", "Fridges"],
  "floorcare > carpet-washers": ["Floorcare", "Hard Floor Cleaners"],
  "floorcare > floor-cleaners": ["Floorcare", "Hard Floor Cleaners"],
  "floorcare > steam-cleaners": ["Floorcare", "Hard Floor Cleaners"],
  "audio > wireless-speakers": ["TV & Audio", "Soundbars & Speakers"],
  "audio > hi-fi-systems": ["TV & Audio", "Soundbars & Speakers"],
};

const feed = JSON.parse(readFileSync(feedPath, "utf8"));
const db = new PrismaClient();

const existing = new Set((await db.product.findMany({ select: { productCode: true } })).map((p) => norm(p.productCode)));
const slugs = new Set((await db.product.findMany({ select: { slug: true } })).map((p) => p.slug));

const missing = feed.filter((r) => !existing.has(norm(r.model)));
console.log(`feed ${feed.length} | already listed ${feed.length - missing.length} | missing ${missing.length}${DRY ? "  (DRY RUN)" : ""}`);

const unmapped = {};
let created = 0, skippedEol = 0, skippedNoPrice = 0, skippedNoMap = 0;

for (const r of missing) {
  if (created >= LIMIT) break;
  const path = (r.category || "").toLowerCase().trim();
  const mapped = MAP[path];
  if (!mapped) { unmapped[path] = (unmapped[path] || 0) + 1; skippedNoMap++; continue; }
  // A discontinued line is not worth putting in front of a customer.
  if (String(r.eol).toLowerCase() === "yes") { skippedEol++; continue; }
  const price = num(r.b2cAgency);
  if (price === null) { skippedNoPrice++; continue; }

  const [category, subcategory] = mapped;
  const isAgency = /agency/i.test(r.stockType || "");
  // Feed titles start with the brand ("AEG BCX23101EM 59.4cm Built In…") —
  // strip brand and code so the card reads like the rest of the catalogue.
  let title = String(r.identifier || `${r.brand} ${r.model}`).trim();
  title = title.replace(new RegExp(`^${r.brand}\\s+`, "i"), "").replace(new RegExp(`^${r.model}\\s*[-–]?\\s*`, "i"), "").trim();
  if (!title) title = `${r.brand} ${r.model}`;

  let slug = slugify(`${r.brand}-${r.model}`);
  if (slugs.has(slug)) slug = slugify(`${r.brand}-${r.model}-${r.articleNo || created}`);
  slugs.add(slug);

  const data = {
    sourceUrl: "", oldUrl: "", slug,
    title: title.slice(0, 200),
    brand: r.brand || "",
    productCode: r.model,
    category, subcategory,
    breadcrumbs: [category, subcategory],
    priceNow: price, priceWas: null, saving: null, currency: "GBP",
    // The shop confirms every sale by phone; asserting live stock we have not
    // seen would be the one dishonest field on the card.
    availabilityRaw: "Call to confirm", availabilityNormalised: "call_to_confirm",
    warranty: String(r.warranty || ""),
    shortDescription: title.slice(0, 200),
    descriptionHtml: "", descriptionText: title.slice(0, 200),
    specifications: [], features: [], energyLabelUrl: "",
    mainImage: "", galleryImages: [],
    relatedProductCodes: [], serviceAddOns: [], deliveryNotes: "",
    seoTitle: `${r.brand} ${title}`.slice(0, 200),
    seoDescription: `${r.brand} ${r.model} — ${title}. Call 0208 864 5763 to confirm price, availability and delivery.`.slice(0, 300),
    gtin: cleanEan(r.ean),
    costPrice: isAgency ? null : num(r.b2b),
    agencyStock: isAgency,
    isVisible: true, featured: false, adminOverrideFields: [],
    lastScrapedAt: new Date(),
  };
  if (!DRY) await db.product.create({ data });
  created++;
  if (created <= 5) console.log(`  + ${r.brand} ${r.model}  £${price}  ${category}/${subcategory}  "${title.slice(0, 40)}"`);
}

console.log(`\ncreated: ${created}${DRY ? " (would be)" : ""}`);
console.log(`skipped: ${skippedNoMap} unmapped category, ${skippedEol} end-of-life, ${skippedNoPrice} no price`);
if (Object.keys(unmapped).length) {
  console.log("\nunmapped feed categories (add to MAP to include):");
  for (const [p, n] of Object.entries(unmapped).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${p}`);
}
await db.$disconnect();
