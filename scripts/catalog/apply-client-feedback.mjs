/**
 * Owner feedback (Aug 2026), data side — idempotent, run against BOTH engines:
 *   node scripts/catalog/apply-client-feedback.mjs            (local sqlite)
 *   DATABASE_URL=postgres://… node scripts/…                  (production)
 *
 * 1. Ninja & Shark hidden (owner no longer sells them) — products AND brand
 *    rows; their RAG docs removed so the chatbot forgets them too.
 * 2. "Call for price" categories: Accessories & Spare Parts (whole dept — Bosch
 *    sell these at the owner's cost price) + Coffee Machines.
 * 3. Owner's main brands pinned to the front of /brands.
 * 4. productCounts recomputed from VISIBLE products only.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

try {
  // -- 1. retire Ninja & Shark -------------------------------------------------
  const retired = ["Ninja", "Shark"];
  const hid = await db.product.updateMany({ where: { brand: { in: retired } }, data: { isVisible: false } });
  await db.brand.updateMany({ where: { name: { in: retired } }, data: { isVisible: false } });
  // RAG product docs are keyed by productCode, not DB id (lib/rag/documents.ts).
  const hiddenCodes = (await db.product.findMany({ where: { brand: { in: retired } }, select: { productCode: true } })).map((p) => p.productCode);
  const rag = await db.rAGDocument.deleteMany({ where: { sourceType: "product", sourceId: { in: hiddenCodes } } });
  console.log(`retired Ninja/Shark : ${hid.count} products hidden, ${rag.count} chatbot docs removed, 2 brands off /brands`);

  // -- 2. call-for-price categories -------------------------------------------
  const dept = await db.category.findFirst({ where: { name: "Accessories & Spare Parts" } });
  const poaIds = [];
  if (dept) {
    poaIds.push(dept.id);
    for (const c of await db.category.findMany({ where: { parentId: dept.id }, select: { id: true } })) poaIds.push(c.id);
  }
  for (const c of await db.category.findMany({ where: { name: "Coffee Machines" }, select: { id: true } })) poaIds.push(c.id);
  const poa = await db.category.updateMany({ where: { id: { in: poaIds } }, data: { priceOnApplication: true } });
  console.log(`call-for-price      : ${poa.count} categories flagged (Accessories dept + Coffee Machines)`);

  // -- 3. pin the owner's main brands ------------------------------------------
  const pins = { Sensis: 1, Blomberg: 2, Schonhaus: 3, Quooker: 4, Smeg: 5 };
  for (const [name, order] of Object.entries(pins)) {
    await db.brand.updateMany({ where: { name }, data: { order } });
  }
  console.log(`brand pinning       : ${Object.keys(pins).join(", ")} -> front of /brands`);

  // -- 4. recompute counts from visible products --------------------------------
  const cats = await db.category.findMany({ select: { id: true, name: true, parentId: true } });
  for (const c of cats) {
    const where = c.parentId ? { subcategory: c.name, isVisible: true } : { category: c.name, isVisible: true };
    await db.category.update({ where: { id: c.id }, data: { productCount: await db.product.count({ where }) } });
  }
  const brands = await db.brand.findMany({ select: { id: true, name: true } });
  for (const b of brands) {
    await db.brand.update({ where: { id: b.id }, data: { productCount: await db.product.count({ where: { brand: b.name, isVisible: true } }) } });
  }
  console.log(`counts recomputed   : ${cats.length} categories, ${brands.length} brands (visible only)`);

  const vis = await db.product.count({ where: { isVisible: true } });
  console.log(`visible products    : ${vis} (of ${await db.product.count()})`);
} finally { await db.$disconnect(); }
