/**
 * Microwaves into Built-in and Freestanding (Sachin, 22 Oct 2026).
 *
 *   PRISMA_CLIENT_DIR=… node scripts/db/with-prod-db.mjs scripts/catalog/split-microwaves.mjs [--apply --backup=file.json]
 *
 * Dry run by default. Freestanding is the larger half, so it keeps the existing
 * "microwaves" row (and its /categories/microwaves URL) under the name
 * "Freestanding Microwaves"; "built-in-microwaves" is new. A microwave is
 * built-in by, in order: the maker's "Built-in / Free-standing" spec, its
 * title, Euronics' own category in its source link, or a model family that
 * only comes built-in. Anything else is a countertop model. One audit row per
 * move; afterwards run recompute-counts.mjs.
 */
import { createRequire } from "module";
import { writeFileSync } from "node:fs";
import { builtInMicrowave } from "./finer-types.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const APPLY = process.argv.includes("--apply");
const BACKUP = (process.argv.find((a) => a.startsWith("--backup=")) || "").slice(9);
if (APPLY && !BACKUP) { console.error("--apply needs --backup=<file.json>"); process.exit(1); }

const db = new PrismaClient();
const [row, exists] = await Promise.all([db.category.findUnique({ where: { id: "microwaves" } }), db.category.findUnique({ where: { id: "built-in-microwaves" } })]);
if (!row) { console.error("no microwaves category"); process.exit(1); }
if (exists) { console.error("built-in-microwaves already exists — refusing"); process.exit(1); }
const OLD = row.name, FREE = "Freestanding Microwaves", BUILT = "Built-in Microwaves";

const ps = await db.product.findMany({ where: { subcategory: OLD }, select: { id: true, productCode: true, brand: true, title: true, isVisible: true, sourceUrl: true, specifications: true, category: true, adminOverrideFields: true } });
const built = ps.filter((p) => !(Array.isArray(p.adminOverrideFields) && p.adminOverrideFields.includes("subcategory")) && builtInMicrowave(p.title, p.specifications, p.sourceUrl, p.productCode));
const free = ps.filter((p) => !built.includes(p));
console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${ps.length} microwaves: ${built.length} built-in (${built.filter((p) => p.isVisible).length} visible), ${free.length} freestanding (${free.filter((p) => p.isVisible).length} visible)`);
console.log("\nbuilt-in:"); built.forEach((p) => console.log(`  ${p.isVisible ? " " : "h"} ${p.brand.padEnd(14)} ${p.productCode.padEnd(16)} ${p.title.slice(0, 70)}`));
console.log("\nfreestanding:"); free.forEach((p) => console.log(`  ${p.isVisible ? " " : "h"} ${p.brand.padEnd(14)} ${p.productCode.padEnd(16)} ${p.title.slice(0, 70)}`));

if (APPLY) {
  writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(), category: { id: "microwaves", name: OLD, order: row.order }, builtIn: built.map((p) => ({ id: p.id, code: p.productCode, subcategory: p.subcategory ?? OLD })) }, null, 1));
  await db.category.create({ data: { id: "built-in-microwaves", name: BUILT, slug: `${row.slug.replace(/\/[^/]*$/, "")}/built-in-microwaves`, parentId: row.parentId, order: row.order + 1, isVisible: true } });
  await db.category.update({ where: { id: "microwaves" }, data: { name: FREE } });
  for (let i = 0; i < built.length; i += 50) {
    await db.$transaction(built.slice(i, i + 50).flatMap((p) => [
      db.product.update({ where: { id: p.id }, data: { subcategory: BUILT, breadcrumbs: [p.category, BUILT], categoryId: "built-in-microwaves" } }),
      db.adminAuditLog.create({ data: { entityType: "product", entityId: p.id, action: "update", changedFields: ["subcategory"],
        previousValue: { subcategory: OLD }, newValue: { subcategory: BUILT }, changedBy: "Rohit (via Claude): built-in / freestanding microwaves (Sachin, Oct 2026)" } }),
    ]));
  }
  await db.product.updateMany({ where: { subcategory: OLD }, data: { subcategory: FREE } });
  // the types after microwaves move up one, so built-in sits beside freestanding
  await db.category.updateMany({ where: { parentId: row.parentId, order: { gt: row.order }, NOT: { id: "built-in-microwaves" } }, data: { order: { increment: 1 } } });
  console.log(`\napplied; backup ${BACKUP}. Next: recompute-counts.mjs`);
}
await db.$disconnect();
