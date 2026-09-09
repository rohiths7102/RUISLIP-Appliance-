/**
 * Give every brand on the shelf a Brand row, and fold duplicate spellings of
 * one brand into a single row.
 *
 *   node scripts/catalog/ensure-brands.mjs [--dry-run]
 *
 * Products carry their brand as free text from whichever importer wrote them,
 * so a supplier range can add brands the Brand table never hears about. Those
 * products are live and sellable but invisible on /brands and in the homepage
 * brand strip, which reads the Brand table. Two spellings of one brand split it
 * the same way ("Fisher and Paykel" against "Fisher & Paykel").
 *
 * Creates only, plus the renames listed in MERGE. An existing row is never
 * otherwise touched: logo, order and description are the owner's to set.
 * productCount is left to recompute-counts.mjs.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const DRY = process.argv.includes("--dry-run");
const db = new PrismaClient();

/** Product brand text -> the spelling to keep. */
const MERGE = { "Fisher and Paykel": "Fisher & Paykel" };

const slugOf = (name) =>
  name.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

for (const [from, to] of Object.entries(MERGE)) {
  const n = await db.product.count({ where: { brand: from } });
  if (!n) continue;
  console.log(`${DRY ? "would merge" : "merged"} ${n} products: "${from}" -> "${to}"`);
  if (!DRY) await db.product.updateMany({ where: { brand: from }, data: { brand: to } });
  if (!DRY) await db.brand.deleteMany({ where: { name: from } });
}

const onShelf = await db.product.groupBy({ by: ["brand"], _count: { _all: true } });
const have = new Set((await db.brand.findMany({ select: { name: true } })).map((b) => b.name));

let made = 0;
for (const { brand, _count } of onShelf.sort((a, b) => b._count._all - a._count._all)) {
  const name = MERGE[brand] || brand;
  if (!name || have.has(name)) continue;
  const slug = slugOf(name);
  console.log(`${DRY ? "would create" : "created"} ${name} (${_count._all} products) -> /brands/${slug}`);
  if (!DRY) {
    await db.brand.create({
      // No logo file for these yet: the strip and /brands fall back to the name
      // in type, which is honest until the artwork is licensed.
      data: { id: slug, name, slug, order: 100 },
    });
  }
  made++;
}
console.log(`${DRY ? "would create" : "created"} ${made} brand rows`);
await db.$disconnect();
