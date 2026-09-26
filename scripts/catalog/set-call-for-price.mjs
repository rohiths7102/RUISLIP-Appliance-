/**
 * Put named products on call-for-price: the price is cleared (the storefront then
 * shows "Call for best pricing") and "priceNow" is locked in adminOverrideFields,
 * so import-euronics-range.mjs and the price sync never put a price back.
 *
 *   node scripts/catalog/set-call-for-price.mjs ids.json [--dry-run]
 *
 * ids.json: an array of Product ids (ids, not codes: codes repeat across brands).
 * Sachin, 26 Sept 2026: Bosch admin list pages 1–14, up to MMB2111SG.
 */
import { createRequire } from "module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const DRY = process.argv.includes("--dry-run");
const file = process.argv.find((a) => a.endsWith(".json"));
if (!file) { console.error("usage: set-call-for-price.mjs <ids.json> [--dry-run]"); process.exit(1); }

const ids = JSON.parse(readFileSync(file, "utf8"));
const db = new PrismaClient();
const rows = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, priceNow: true, adminOverrideFields: true } });

let cleared = 0, locked = 0;
for (const p of rows) {
  const fields = Array.isArray(p.adminOverrideFields) ? p.adminOverrideFields : [];
  const needLock = !fields.includes("priceNow");
  if (p.priceNow == null && !needLock) continue;
  if (p.priceNow != null) cleared++;
  if (needLock) locked++;
  if (!DRY) await db.product.update({ where: { id: p.id }, data: {
    priceNow: null, priceWas: null, saving: null,
    adminOverrideFields: needLock ? [...fields, "priceNow"] : fields,
  } });
}
console.log(`${DRY ? "DRY RUN — " : ""}${rows.length} of ${ids.length} found; prices cleared ${cleared}, price locked ${locked}`);
await db.$disconnect();
