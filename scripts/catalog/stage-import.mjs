/**
 * Wave 3 staging — normalise the owner-supplied catalogue drops into ONE list
 * ready for import, classified with the SAME taxonomy the live catalogue uses.
 *
 *   node scripts/catalog/stage-import.mjs <stageDir> <extraDir> <outFile>
 *
 * Sources (identical folder shape, <Brand>/<CODE>/product.json + NN.jpg):
 *   - the employee zip (ruislipappliances.com capture)
 *   - products captured from the client's own kitchen-appliances.co.uk
 *
 * Rules the owner set: Ninja & Shark are retired, so they never enter. Anything
 * already in the database is skipped (the drops re-send existing stock).
 * Classification NEVER trusts the drop's own "category" field — it is just the
 * brand name — so every product runs through classify() on title + description.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "module";
import { classify, LEAF } from "./taxonomy.mjs";
import { buildTitle } from "./product-title.mjs";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

const [stageDir, extraDir, outFile] = process.argv.slice(2);
const RETIRED = new Set(["Ninja", "Shark"]);
const JUNK = new Set(["PALLET"]);

/** Walk <root>/<Brand>/<CODE>/ folders into raw records. */
function readDrop(root, sourceLabel) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const brand of readdirSync(root)) {
    const bDir = join(root, brand);
    if (!statSync(bDir).isDirectory()) continue;
    for (const code of readdirSync(bDir)) {
      const dir = join(bDir, code);
      if (!statSync(dir).isDirectory()) continue;
      const pj = join(dir, "product.json");
      if (!existsSync(pj)) continue;
      let j;
      try { j = JSON.parse(readFileSync(pj, "utf8")); } catch { continue; }
      const images = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
      out.push({ brand, code, dir, json: j, localImages: images, sourceLabel });
    }
  }
  return out;
}

const db = new PrismaClient();
const existing = new Set((await db.product.findMany({ select: { productCode: true } })).map((p) => p.productCode.toUpperCase().trim()));
const existingSlugs = new Set((await db.product.findMany({ select: { slug: true } })).map((p) => p.slug));

/**
 * Drop folders are named by hand, so the same maker arrives as "Fisher" one week
 * and "Fisher & Paykel" the next, or "NUTRIBULLET" against an existing
 * "Nutribullet". Each spelling would mint its own brand row, its own brand page
 * and its own filter entry — the catalogue splits in two. Resolve every drop
 * folder against the brands already in the database, case-insensitively, and
 * keep the name the database already uses.
 */
const brandRows = await db.brand.findMany({ select: { name: true } });
const brandByKey = new Map(brandRows.map((b) => [b.name.toLowerCase().replace(/[^a-z0-9]/g, ""), b.name]));
const canonicalBrand = (folder) => {
  const raw = String(folder).trim();
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (brandByKey.has(key)) return brandByKey.get(key);
  // A truncated folder name ("Fisher" for "Fisher & Paykel") is only ever a
  // prefix of the real brand — never fold one brand into an unrelated longer one.
  const prefixed = brandRows.map((b) => b.name).filter((n) => n.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(key) && key.length >= 4);
  return prefixed.length === 1 ? prefixed[0] : raw;
};

const raw = [...readDrop(stageDir, "employee-zip"), ...readDrop(extraDir, "client-site")];
const seen = new Set();
const staged = [];
const skipped = { retired: 0, junk: 0, duplicateInDb: 0, duplicateInDrop: 0, noTitle: 0, noImage: 0 };

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);

for (const r of raw) {
  const code = String(r.code).toUpperCase().trim();
  const brand = canonicalBrand(r.brand);
  // Match retirement on both spellings: the owner's rule is about the maker, not
  // about however this week's drop folder happens to be typed.
  if (RETIRED.has(brand) || RETIRED.has(r.brand)) { skipped.retired++; continue; }
  if (JUNK.has(brand) || JUNK.has(r.brand)) { skipped.junk++; continue; }
  if (existing.has(code)) { skipped.duplicateInDb++; continue; }
  if (seen.has(code)) { skipped.duplicateInDrop++; continue; }

  const j = r.json || {};
  // The drop's "name" is only "<Brand> <CODE>" — the real product name lives in
  // the description. See product-title.mjs for why this matters.
  const title = buildTitle(j, brand, code);
  if (!title) { skipped.noTitle++; continue; }
  if (!r.localImages.length) { skipped.noImage++; continue; }

  // Classify on the real text — the drop's "category" is only the brand name.
  // classify() returns a leaf id; LEAF maps it to the department + leaf names
  // the storefront renders (same path scripts/catalog/build.mjs takes).
  let cls;
  try { cls = classify({ name: title, description: String(j.description || ""), source: r.sourceLabel, key: code }); }
  catch { skipped.classifyFailed = (skipped.classifyFailed || 0) + 1; continue; }
  const meta = LEAF.get(cls.leaf);
  if (!meta) { skipped.badLeaf = (skipped.badLeaf || 0) + 1; continue; }
  const category = meta.topName, subcategory = meta.leafName;

  let slug = slugify(`${brand}-${code}`);
  if (existingSlugs.has(slug) || staged.some((s) => s.slug === slug)) slug = slugify(`${brand}-${code}-${staged.length}`);

  seen.add(code);
  staged.push({
    slug, title, brand, productCode: code,
    category, subcategory,
    priceNow: typeof j.price === "number" && j.price > 0 ? j.price : null,
    shortDescription: String(j.description || "").replace(/&amp;/g, "&").slice(0, 400),
    sourceUrl: j.source_url || "", source: r.sourceLabel,
    dir: r.dir, localImages: r.localImages,
    remoteImages: Array.isArray(j.images) ? j.images.slice(0, 8) : [],
  });
}

const byCat = {};
for (const s of staged) byCat[`${s.category} > ${s.subcategory}`] = (byCat[`${s.category} > ${s.subcategory}`] || 0) + 1;
const noPrice = staged.filter((s) => s.priceNow === null).length;

console.log(`raw records read : ${raw.length}`);
console.log(`skipped          : ${JSON.stringify(skipped)}`);
console.log(`STAGED FOR IMPORT: ${staged.length}  (without a price: ${noPrice})`);
console.log(`\nby classified department:`);
const byDept = {};
for (const s of staged) byDept[s.category] = (byDept[s.category] || 0) + 1;
for (const [d, n] of Object.entries(byDept).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${d}`);
console.log(`\ntop leaf categories:`);
for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(4)}  ${c}`);

writeFileSync(outFile, JSON.stringify(staged, null, 1));
console.log(`\nwrote ${outFile}`);
await db.$disconnect();
