/**
 * Create any Category row the taxonomy declares but the database is missing.
 *
 *   node scripts/catalog/ensure-taxonomy-categories.mjs [--dry-run]
 *
 * taxonomy.mjs is the source of truth for what departments exist, but until now
 * the only thing that turned it into Category rows was `npm run db:seed` — which
 * also walks Product and reverts the owner's own price and visibility edits, so
 * it cannot be run on a database with live stock. Adding a department (Sinks &
 * Taps) therefore left products classified into leaves that had no row, and
 * /categories/<id> answers 404 for a leaf that does not exist.
 *
 * Creates only. An existing row is never touched: name, image, order and the
 * price-on-application tick are the owner's to set from the admin, and this
 * script must not undo that. productCount starts at 0 and is recomputed by the
 * importer that fills the shelf.
 */
import { createRequire } from "module";
import { TREE } from "./taxonomy.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const DRY = process.argv.includes("--dry-run");
const db = new PrismaClient();

const have = new Set((await db.category.findMany({ select: { id: true } })).map((c) => c.id));
const missing = [];
for (const top of TREE) {
  if (!have.has(top.id)) {
    missing.push({ id: top.id, name: top.name, slug: `/${top.id}`, parentId: null, description: top.blurb || "" });
  }
  for (const leaf of top.children) {
    if (!have.has(leaf.id)) {
      missing.push({ id: leaf.id, name: leaf.name, slug: `/${top.id}/${leaf.id}`, parentId: top.id, description: "" });
    }
  }
}

if (!missing.length) {
  console.log(`All ${have.size} taxonomy categories already exist. Nothing to do.`);
} else {
  console.log(`${have.size} existing, ${missing.length} missing${DRY ? "  (DRY RUN)" : ""}:`);
  for (const m of missing) console.log(`  ${m.parentId ? "  " : ""}${m.id.padEnd(26)} ${m.slug}`);
  // Parents first: a leaf carries parentId, which is a real FK.
  if (!DRY) for (const m of missing.filter((x) => !x.parentId).concat(missing.filter((x) => x.parentId))) {
    await db.category.create({ data: { ...m, productCount: 0 } });
  }
  console.log(DRY ? "\n(dry run — nothing written)" : `\nCreated ${missing.length}.`);
}
await db.$disconnect();
