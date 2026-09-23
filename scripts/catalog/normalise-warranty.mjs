/**
 * Put every product's warranty on the admin template ("5 Year Warranty"), the
 * same rule the admin applies on save (lib/warranty.ts normaliseWarranty):
 * a bare number or "N years" becomes "N Year Warranty"; longer manufacturer
 * wording is left exactly as it is. Dry run unless --apply.
 *
 *   node scripts/catalog/normalise-warranty.mjs [--apply]
 *   PRISMA_CLIENT_DIR=.prisma-pg/client node scripts/db/with-prod-db.mjs scripts/catalog/normalise-warranty.mjs [--apply]
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const dir = process.env.PRISMA_CLIENT_DIR;
const { PrismaClient } = require(dir ? resolve(dir) : "@prisma/client");

// Keep in step with lib/warranty.ts.
const label = (y) => `${y} Year Warranty`;
function normaliseWarranty(raw) {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  const n = t.match(/^(\d{1,2})\s*(?:yrs?|years?)?(?:\s+(?:warranty|guarantee))?$/i);
  return n && Number(n[1]) > 0 ? label(Number(n[1])) : t;
}

const apply = process.argv.includes("--apply");
const db = new PrismaClient();
try {
  const rows = await db.product.findMany({ select: { id: true, productCode: true, warranty: true, adminOverrideFields: true } });
  const changes = rows.map((r) => ({ ...r, to: normaliseWarranty(r.warranty) })).filter((r) => r.to !== r.warranty);
  const tally = new Map();
  for (const c of changes) { const k = `${JSON.stringify(c.warranty)} -> ${c.to}`; tally.set(k, (tally.get(k) || 0) + 1); }
  console.log(`${rows.length} products; ${changes.length} warranty values off the template`);
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(6), k);
  if (!apply) { console.log("Dry run. Re-run with --apply to write."); process.exit(0); }
  for (const c of changes) {
    const locks = new Set(Array.isArray(c.adminOverrideFields) ? c.adminOverrideFields : []);
    locks.add("warranty"); // a re-scrape must not put the bare number back
    await db.product.update({ where: { id: c.id }, data: { warranty: c.to, adminOverrideFields: [...locks] } });
  }
  await db.adminAuditLog.create({ data: {
    entityType: "product", entityId: `warranty-template:${changes.length}`, action: "warranty:normalise",
    changedFields: ["warranty"], previousValue: Object.fromEntries(tally), newValue: { updated: changes.length }, changedBy: "script:normalise-warranty",
  } }).catch((e) => console.warn("audit not written:", e.message));
  console.log(`Updated ${changes.length}.`);
} finally {
  await db.$disconnect();
}
