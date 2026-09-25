/**
 * Show exactly the models the owner lists for one brand, and hide the rest.
 *
 *   node scripts/catalog/apply-brand-list.mjs list.json [--dry-run]
 *
 *   list.json: { "brand": "Miele", "skus": ["MIEBOOSTCX1", "MIEWEE385WCS", …] }
 *
 * Sachin, 25 Sept 2026: "Only this Miele products need to be on the site. We
 * have models there which are out of production." The SKUs are Euronics' — a
 * three-letter brand code plus the model — matched to our productCode on the
 * model, the same split import-euronics-range.mjs makes.
 *
 * Nothing is deleted: a hidden product is one tick away in Admin → Products.
 * Listed models we don't hold are only reported — create them first with
 *   node scripts/catalog/import-euronics-range.mjs --sku <SKU,SKU,…>
 */
import { createRequire } from "module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const DRY = process.argv.includes("--dry-run");
const file = process.argv.find((a) => a.endsWith(".json"));
if (!file) { console.error("usage: apply-brand-list.mjs <list.json> [--dry-run]"); process.exit(1); }

const { brand, skus } = JSON.parse(readFileSync(file, "utf8"));
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const wanted = new Map(skus.map((s) => [norm(s).slice(3), norm(s)])); // model -> SKU

const db = new PrismaClient();
const all = await db.product.findMany({ select: { id: true, productCode: true, brand: true, title: true, isVisible: true } });
const mine = all.filter((p) => p.brand.trim().toLowerCase() === brand.toLowerCase());
// Visible rows first, so a hidden duplicate of a listed model stays hidden
// instead of appearing beside the live one.
mine.sort((a, b) => Number(b.isVisible) - Number(a.isVisible));

const kept = new Set(), show = [], hide = [];
for (const p of mine) {
  const model = norm(p.productCode);
  if (wanted.has(model) && !kept.has(model)) {
    kept.add(model);
    if (!p.isVisible) show.push(p);
  } else if (p.isVisible) {
    hide.push(p);
  }
}
const missing = [...wanted].filter(([model]) => !kept.has(model)).map(([, sku]) => sku);

console.log(`${DRY ? "DRY RUN — " : ""}${brand}: ${mine.length} rows, ${kept.size} of ${wanted.size} listed models held; show ${show.length}, hide ${hide.length}`);
for (const p of show) console.log(`  show  ${p.productCode.padEnd(20)} ${p.title.slice(0, 64)}`);
for (const p of hide) console.log(`  hide  ${p.productCode.padEnd(20)} ${p.title.slice(0, 64)}`);
if (missing.length) {
  console.log(`\nlisted but not held (${missing.length}) — import them, then run this again:`);
  console.log(`  node scripts/catalog/import-euronics-range.mjs --sku ${missing.join(",")}`);
}

if (!DRY) {
  await db.product.updateMany({ where: { id: { in: show.map((p) => p.id) } }, data: { isVisible: true } });
  await db.product.updateMany({ where: { id: { in: hide.map((p) => p.id) } }, data: { isVisible: false } });
}
await db.$disconnect();
