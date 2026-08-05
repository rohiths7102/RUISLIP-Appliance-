/**
 * Wave 3 import — bring the staged catalogue drop into a database.
 *
 *   node scripts/catalog/import-staged.mjs <staged.json> --upload   (first run:
 *        uploads each primary image to Blob once, writes blob-map.json)
 *   DATABASE_URL=postgres://… node scripts/catalog/import-staged.mjs <staged.json>
 *        (second run: reuses blob-map.json — no duplicate Blob operations)
 *
 * Idempotent: products that already exist (by productCode) are skipped.
 * Creates missing Brand rows, links categoryId by leaf name, syncs the RAG doc
 * when the target DB has an index built, and recomputes visible counts.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

// .env.local / .env loading (plain node) — for BLOB_READ_WRITE_TOKEN
for (const f of [".env.local", ".env"]) {
  const fp = join(process.cwd(), f);
  if (!existsSync(fp)) continue;
  for (const line of readFileSync(fp, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const [stagedFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DO_UPLOAD = process.argv.includes("--upload");
const staged = JSON.parse(readFileSync(stagedFile, "utf8"));
const mapFile = join(dirname(stagedFile), "blob-map.json");
const blobMap = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, "utf8")) : {};

const CT = { ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

if (DO_UPLOAD) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) { console.error("✗ BLOB_READ_WRITE_TOKEN missing"); process.exit(1); }
  const { put } = await import("@vercel/blob");
  let done = 0, bytes = 0;
  for (const s of staged) {
    if (blobMap[s.productCode]) { done++; continue; } // resume-safe
    const img = s.localImages[0];
    const body = readFileSync(join(s.dir, img));
    const ext = extname(img).toLowerCase();
    const key = `catalog/${s.brand.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/${s.productCode}/01${ext}`;
    const { url } = await put(key, body, { access: "public", token, contentType: CT[ext] || "image/jpeg", addRandomSuffix: false, allowOverwrite: true });
    blobMap[s.productCode] = url;
    bytes += body.length;
    if (++done % 50 === 0 || done === staged.length) {
      writeFileSync(mapFile, JSON.stringify(blobMap, null, 1));
      console.log(`  uploaded ${done}/${staged.length} (${(bytes / 1048576).toFixed(1)} MB)`);
    }
  }
  writeFileSync(mapFile, JSON.stringify(blobMap, null, 1));
  console.log(`images on Blob: ${Object.keys(blobMap).length}`);
}

const db = new PrismaClient();
try {
  const existing = new Set((await db.product.findMany({ select: { productCode: true } })).map((p) => p.productCode.toUpperCase()));

  // brands: create the missing ones (owner can set logos/rank in admin later)
  const brandRows = await db.brand.findMany({ select: { name: true } });
  const haveBrands = new Set(brandRows.map((b) => b.name));
  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let newBrands = 0;
  for (const name of new Set(staged.map((s) => s.brand))) {
    if (haveBrands.has(name)) continue;
    await db.brand.upsert({ where: { slug: slugify(name) }, update: {}, create: { id: slugify(name), name, slug: slugify(name), sourceUrl: "", logo: "" } });
    newBrands++;
  }

  const cats = await db.category.findMany({ select: { id: true, name: true, parentId: true } });
  const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
  // If this DB has a built RAG index, rebuild it AFTER import (npm run rag:build)
  // so the chatbot learns the new stock; an empty index falls through to the live
  // catalogue automatically and needs nothing.
  const ragActive = (await db.rAGDocument.count()) > 0;

  let created = 0, skipped = 0, noBlob = 0;
  for (const s of staged) {
    if (existing.has(s.productCode.toUpperCase())) { skipped++; continue; }
    const mainImage = blobMap[s.productCode];
    if (!mainImage) { noBlob++; continue; }
    const categoryId = catByName.get(s.subcategory.toLowerCase()) || catByName.get(s.category.toLowerCase()) || null;
    const row = await db.product.create({ data: {
      sourceUrl: s.sourceUrl || "", oldUrl: "", slug: s.slug, title: s.title, brand: s.brand, productCode: s.productCode,
      category: s.category, subcategory: s.subcategory, breadcrumbs: [s.category, s.subcategory],
      priceNow: s.priceNow, priceWas: null, saving: null, currency: "GBP",
      availabilityRaw: "", availabilityNormalised: "call_to_confirm",
      warranty: "", shortDescription: s.shortDescription, descriptionHtml: "", descriptionText: s.shortDescription,
      specifications: [], features: [], energyLabelUrl: "",
      mainImage, galleryImages: [mainImage], relatedProductCodes: [], serviceAddOns: [],
      deliveryNotes: "", seoTitle: "", seoDescription: "",
      lastScrapedAt: new Date(), adminOverrideFields: [], categoryId, isVisible: true,
    } });
    void row;
    created++;
  }

  // recompute visible counts (same rules as apply-client-feedback)
  for (const c of cats) {
    const where = c.parentId ? { subcategory: c.name, isVisible: true } : { category: c.name, isVisible: true };
    await db.category.update({ where: { id: c.id }, data: { productCount: await db.product.count({ where }) } });
  }
  for (const b of await db.brand.findMany({ select: { id: true, name: true } })) {
    await db.brand.update({ where: { id: b.id }, data: { productCount: await db.product.count({ where: { brand: b.name, isVisible: true } }) } });
  }

  console.log(`created ${created}, skipped-existing ${skipped}, missing-blob ${noBlob}, new brands ${newBrands}`);
  console.log(`visible products now: ${await db.product.count({ where: { isVisible: true } })}`);
  if (ragActive) console.log(`NOTE: this DB has a built RAG index — run \`npm run rag:build\` so the chatbot learns the new stock.`);
} finally { await db.$disconnect(); }
