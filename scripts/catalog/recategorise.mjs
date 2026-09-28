/**
 * Move products to another department and sub-category from a list, audited.
 *
 *   node scripts/catalog/recategorise.mjs moves.json [--dry-run]
 *
 *   moves.json: { "reason": "…", "moves": [{ "id": "…", "code": "…", "to": ["Cooking", "Hobs"] }, …] }
 *
 * Every target must be a real department with that child sub-category (the
 * admin's checkTaxonomy rule), or nothing is written. Each move leaves one
 * AdminAuditLog row, as an edit in Admin → Products does. Afterwards run
 * recompute-counts.mjs, and reindex the moved products for the chatbot.
 */
import { createRequire } from "module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const DRY = process.argv.includes("--dry-run");
const file = process.argv.find((a) => a.endsWith(".json"));
if (!file) { console.error("usage: recategorise.mjs <moves.json> [--dry-run]"); process.exit(1); }
const { reason, moves } = JSON.parse(readFileSync(file, "utf8"));

const db = new PrismaClient();
const cats = await db.category.findMany({ select: { id: true, name: true, parentId: true } });
const bad = moves.filter(({ to: [c, s] }) => {
  const top = cats.find((x) => !x.parentId && x.name === c);
  return !top || !cats.some((x) => x.parentId === top.id && x.name === s);
});
if (bad.length) { console.error(`not a department › sub-category: ${bad.map((m) => `${m.code} → ${m.to.join(" › ")}`).join("; ")}`); process.exit(1); }

const rows = await db.product.findMany({ where: { id: { in: moves.map((m) => m.id) } }, select: { id: true, productCode: true, category: true, subcategory: true } });
const byId = new Map(rows.map((p) => [p.id, p]));
let moved = 0, already = 0, missing = 0;
for (const m of moves) {
  const p = byId.get(m.id);
  if (!p) { missing++; console.log(`  missing ${m.code}`); continue; }
  const [category, subcategory] = m.to;
  if (p.category === category && p.subcategory === subcategory) { already++; continue; }
  console.log(`  ${p.productCode.padEnd(16)} ${`${p.category} › ${p.subcategory}`.padEnd(46)} → ${category} › ${subcategory}`);
  if (!DRY) {
    await db.product.update({ where: { id: p.id }, data: { category, subcategory, breadcrumbs: [category, subcategory] } });
    await db.adminAuditLog.create({ data: {
      entityType: "product", entityId: p.id, action: "update", changedFields: ["category", "subcategory"],
      previousValue: { category: p.category, subcategory: p.subcategory }, newValue: { category, subcategory },
      changedBy: `Rohit (via Claude): ${reason}`,
    } });
  }
  moved++;
}
console.log(`${DRY ? "DRY RUN — " : ""}${moved} moved, ${already} already there, ${missing} not found`);
await db.$disconnect();
