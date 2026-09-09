/**
 * Recompute Category.productCount and Brand.productCount from visible products.
 *
 *   node scripts/catalog/recompute-counts.mjs [--dry-run]
 *
 * Every importer's closing line says "recompute counts" but none of them names a
 * script, because the only general-purpose one is apply-client-feedback.mjs --
 * which also re-hides retired brands, resets price-on-application ticks and drops
 * the RAG index on its way past. That is not safe to run just to fix a number, so
 * this does only the counting.
 *
 * The counts drive the "n models" figure on every department chip and brand card;
 * a freshly filled shelf reads "0" until this runs.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const DRY = process.argv.includes("--dry-run");
const db = new PrismaClient();
try {
  const changed = [];
  // A top-level row counts by `category`, a leaf by `subcategory` — products
  // carry the display NAMES, which is what import-staged.mjs:122-124 assumes too.
  for (const c of await db.category.findMany({ select: { id: true, name: true, parentId: true, productCount: true } })) {
    const n = await db.product.count({
      where: { isVisible: true, ...(c.parentId ? { subcategory: c.name } : { category: c.name }) },
    });
    if (n !== c.productCount) {
      changed.push(`  category ${c.id.padEnd(28)} ${c.productCount} -> ${n}`);
      if (!DRY) await db.category.update({ where: { id: c.id }, data: { productCount: n } });
    }
  }
  for (const b of await db.brand.findMany({ select: { id: true, name: true, productCount: true } })) {
    const n = await db.product.count({ where: { isVisible: true, brand: b.name } });
    if (n !== b.productCount) {
      changed.push(`  brand    ${b.id.padEnd(28)} ${b.productCount} -> ${n}`);
      if (!DRY) await db.brand.update({ where: { id: b.id }, data: { productCount: n } });
    }
  }
  console.log(changed.length ? changed.join("\n") : "  all counts already correct");
  console.log(`\n${changed.length} row(s) ${DRY ? "would change (DRY RUN)" : "updated"}.`);
} finally { await db.$disconnect(); }
