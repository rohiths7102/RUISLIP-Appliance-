/**
 * Every Quooker tap in every finish, from quooker.co.uk/taps, as call-for-price
 * listings.
 *
 *   node scripts/catalog/import-quooker-finishes.mjs [--dry-run]
 *
 * Sachin, 29 Sept 2026: "load all the Quooker products shown on the site. We
 * seem to be missing lots of models." import-supplier-range.mjs makes one
 * listing per Quooker page, but a Quooker page is a tap FAMILY with a finish
 * picker, so it only ever made the 12 family listings. The taps page embeds the
 * whole range in its Next.js payload: each finish with Quooker's article
 * number, EAN, size, description and a 700px photo. One listing per article
 * number, matched on brand + code, so a re-run adds only what is new. No price,
 * like the rest of the Quooker range (Boiling Water Taps is call-for-price).
 * Tanks (PRO3, COMBI, COMBI+) carry no photo here; they come from their own
 * pages via import-supplier-range.mjs --supplier quooker.
 */
import { createRequire } from "module";
import { classify, LEAF } from "./taxonomy.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const DRY = process.argv.includes("--dry-run");
const PAGE = "https://www.quooker.co.uk/taps";
const UA = "JyotsnaElectricalBot/1.0 (+catalogue sync, Quooker dealer; contact rohith@kroneuszerotrust.com)";
const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

const html = await (await fetch(PAGE, { headers: { "User-Agent": UA } })).text();
// The payload is a run of JS string literals; JSON.parse undoes their escaping exactly.
const data = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map((m) => JSON.parse(m[1])).join("");
const taps = new Map();
for (const m of data.matchAll(/"__typename":"ContentfulProduct","sku":"([^"]+)","name":"([^"]+)"/g)) {
  const [, sku, name] = m;
  const after = data.slice(m.index, m.index + 4000);
  const family = [...data.slice(Math.max(0, m.index - 3000), m.index).matchAll(/"__typename":"TapType","variant":"[A-Z_]+","title":"([^"]+)","moreInfoPage":"([^"]*)"/g)].pop();
  const image = (after.match(/"main":"(https:[^"]+)"/) || [])[1];
  if (!family || !image || taps.has(sku)) continue; // tanks have no tap family and no photo here
  taps.set(sku, {
    sku, name, page: `https://www.quooker.co.uk${family[2]}`, image,
    description: (after.match(/"shortDescription":\{"json":\{.*?"value":"([^"]*)"/) || [])[1] || "",
    gtin: (after.match(/"gtin":"(\d{8,14})"/) || [])[1] || "",
    size: (after.match(/"size":"([^"]*)"/) || [])[1] || "",
    finish: (after.match(/"ecommerceData":\{.*?"finish":"([^"]*)"/) || [])[1] || "",
  });
}
if (taps.size < 20) { console.error(`only ${taps.size} taps read from ${PAGE} — the page changed shape; nothing written`); process.exit(1); }

const db = new PrismaClient();
const existing = await db.product.findMany({ select: { slug: true, brand: true, productCode: true } });
const have = new Set(existing.filter((p) => /^quooker$/i.test(p.brand)).map((p) => p.productCode.toUpperCase()));
const slugs = new Set(existing.map((p) => p.slug));
let created = 0, already = 0;
for (const t of taps.values()) {
  if (have.has(t.sku.toUpperCase())) { already++; continue; }
  const leaf = LEAF.get(classify({ name: t.name, description: t.name, source: "quooker", key: t.sku }).leaf);
  let slug = slugify(t.name);
  for (let i = 2; slugs.has(slug); i++) slug = `${slugify(t.name)}-${i}`;
  slugs.add(slug);
  const finish = t.finish ? t.finish[0].toUpperCase() + t.finish.slice(1) : "";
  const text = `${t.description}${t.size ? ` ${t.size}.` : ""} Works with a Quooker PRO3, COMBI or COMBI+ tank — call us to put your system together.`;
  console.log(`  ${DRY ? "would add" : "add"} ${t.sku.padEnd(10)} ${t.name.padEnd(52)} → ${leaf.topName} › ${leaf.leafName}`);
  if (!DRY) await db.product.create({ data: {
    slug, title: t.name, brand: "Quooker", productCode: t.sku, gtin: t.gtin,
    category: leaf.topName, subcategory: leaf.leafName, breadcrumbs: [leaf.topName, leaf.leafName],
    priceNow: null, priceWas: null, saving: null, currency: "GBP", // quoted on the phone
    availabilityNormalised: "call_to_confirm", availabilityRaw: "",
    warranty: "", shortDescription: t.description.slice(0, 400), descriptionText: text, descriptionHtml: "",
    mainImage: t.image, galleryImages: [t.image],
    specifications: [finish && { label: "Finish", value: finish }, t.size && { label: "Size", value: t.size }].filter(Boolean),
    features: [], relatedProductCodes: [], serviceAddOns: [],
    sourceUrl: t.page, oldUrl: "", isVisible: true, adminOverrideFields: [],
    seoTitle: `${t.name} Boiling Water Tap`.slice(0, 70),
    seoDescription: `${t.name} boiling water tap. Call 0208 864 5763 for price, availability and fitting.`.slice(0, 300),
    lastScrapedAt: new Date(),
  } });
  created++;
}
console.log(`\nQuooker taps on ${PAGE}: ${taps.size} | ${DRY ? "would add" : "added"}: ${created} | already on the site: ${already}`);
await db.$disconnect();
