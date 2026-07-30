/**
 * Push catalogue images into Vercel Blob and repoint every image reference at the
 * Blob URL — so the storefront (product cards, product pages, the hero slideshow
 * animation, category heroes) and the RAG chatbot all stay perfectly in sync.
 *
 * Source of truth is the DB fields product.mainImage / product.galleryImages and
 * category.image (all consumed through lib/repo.ts). We also rewrite the JSON seed
 * source (data/products.json, data/categories.json) so a fresh Postgres seed on
 * Vercel lands the same Blob URLs.
 *
 * Modes:
 *   (default)     upload ONE primary image per product (mainImage) + category heroes;
 *                 galleries collapse to [primary] so nothing 404s. ~1,565 files, ~330MB.
 *   --full        also upload every gallery image (~11.7k files, ~2.5GB — needs paid Blob).
 *   --dry-run     no uploads, no writes — just prove the mapping + report sizes. No token needed.
 *
 * Auth: reads BLOB_READ_WRITE_TOKEN from the environment. Get it with either
 *   vercel link && vercel env pull .env.local      (recommended), or
 *   paste BLOB_READ_WRITE_TOKEN=... into .env.local
 * The token never needs to be shown in chat.
 *
 * Idempotent: deterministic Blob keys (no random suffix) → re-running overwrites the
 * same URL; products already on an http(s) image are skipped.
 */
import { createRequire } from "module";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

// Load env from .env.local then .env (plain `node` doesn't do this) so the Blob
// token — added via `vercel env pull .env.local` or by hand — is picked up.
for (const f of [".env.local", ".env"]) {
  const fp = join(process.cwd(), f);
  if (!existsSync(fp)) continue;
  for (const line of readFileSync(fp, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const DRY = process.argv.includes("--dry-run");
const FULL = process.argv.includes("--full");
const ROOT = process.cwd();
const PUBLIC = join(ROOT, "public");
const CT = { ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".avif": "image/avif" };
const isLocal = (s) => typeof s === "string" && s.startsWith("/catalog/");
const ctOf = (p) => CT[p.slice(p.lastIndexOf(".")).toLowerCase()] || "application/octet-stream";
const mb = (b) => (b / 1048576).toFixed(1) + " MB";

const db = new PrismaClient();
let products, cats;
try {
  products = await db.product.findMany({ select: { id: true, slug: true, mainImage: true, galleryImages: true } });
  cats = await db.category.findMany({ select: { id: true, slug: true, image: true } });
} catch (e) {
  // The generated client is bound to ONE provider. Pointing this script at the
  // production Postgres while the sqlite client is generated (the state
  // `pg:deploy` leaves behind) fails validation before a single byte is read.
  const msg = String(e?.message || e);
  if (/provider|datasource|the URL must start with the protocol/i.test(msg)) {
    console.error(
      `\n✗ The generated Prisma client doesn't match DATABASE_URL.\n` +
      `  Targeting production Postgres? Generate that client first:\n` +
      `      npx prisma generate --schema prisma/schema.postgres.prisma\n` +
      `  …then re-run, and restore the local client afterwards with:\n` +
      `      npx prisma generate\n`
    );
    await db.$disconnect();
    process.exit(1);
  }
  throw e;
}

// ---- 1. collect the unique set of local files we must upload ----
const need = new Set();
for (const p of products) {
  if (isLocal(p.mainImage)) need.add(p.mainImage);
  if (FULL) for (const g of p.galleryImages || []) if (isLocal(g)) need.add(g);
}
for (const c of cats) if (isLocal(c.image)) need.add(c.image);

// ---- 2. verify every file exists on disk + measure ----
let bytes = 0;
const missing = [];
for (const rel of need) {
  const fp = join(PUBLIC, rel);
  if (existsSync(fp)) bytes += statSync(fp).size;
  else missing.push(rel);
}
const noMain = products.filter((p) => !p.mainImage).map((p) => p.slug);
const alreadyHttp = products.filter((p) => /^https?:\/\//.test(p.mainImage)).length;

console.log(`\n=== Blob image sync ${DRY ? "(DRY RUN)" : ""} ${FULL ? "[FULL galleries]" : "[primary per product]"} ===`);
console.log(`products               : ${products.length}`);
console.log(`categories             : ${cats.length} (with hero image ${cats.filter((c) => c.image).length})`);
console.log(`unique images to upload: ${need.size}`);
console.log(`total upload size      : ${mb(bytes)}${bytes > 1073741824 ? "  ⚠ EXCEEDS 1GB free tier" : "  (under 1GB free tier)"}`);
console.log(`missing files on disk  : ${missing.length}${missing.length ? "  -> " + missing.slice(0, 5).join(", ") + (missing.length > 5 ? " …" : "") : ""}`);
console.log(`products w/o any image : ${noMain.length}${noMain.length ? "  -> " + noMain.join(", ") : ""}`);
console.log(`already on http (skip) : ${alreadyHttp}`);

if (DRY) {
  console.log(`\nDRY RUN — nothing uploaded or changed. Provide BLOB_READ_WRITE_TOKEN and re-run without --dry-run.`);
  await db.$disconnect();
  process.exit(0);
}

// ---- 3. real upload ----
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error(`\n✗ BLOB_READ_WRITE_TOKEN is not set. Run:  vercel link && vercel env pull .env.local   (or add it to .env.local), then re-run.`);
  await db.$disconnect();
  process.exit(1);
}
const { put } = await import("@vercel/blob");
const files = [...need].filter((rel) => !missing.includes(rel));
const map = new Map();     // localPath -> blob url
let done = 0, upBytes = 0;
const CONC = 8;

async function worker(queue) {
  for (;;) {
    const rel = queue.pop();
    if (!rel) return;
    const fp = join(PUBLIC, rel);
    const body = await readFile(fp);
    const key = rel.replace(/^\/+/, "");                       // "catalog/bosch/00056317/01.webp"
    const { url } = await put(key, body, { access: "public", token, contentType: ctOf(rel), addRandomSuffix: false, allowOverwrite: true });
    map.set(rel, url);
    upBytes += body.length;
    if (++done % 100 === 0 || done === files.length) console.log(`  uploaded ${done}/${files.length}  (${mb(upBytes)})`);
  }
}
const queue = [...files];
await Promise.all(Array.from({ length: CONC }, () => worker(queue)));
console.log(`\nUploaded ${map.size} images (${mb(upBytes)}). Repointing references…`);

// ---- 4. rewrite DB (local SQLite / prod Postgres — whatever DATABASE_URL points at) ----
let pUpd = 0;
for (const p of products) {
  const patch = {};
  if (map.has(p.mainImage)) patch.mainImage = map.get(p.mainImage);
  if (FULL) {
    const ng = (p.galleryImages || []).map((g) => map.get(g) || g);
    if (JSON.stringify(ng) !== JSON.stringify(p.galleryImages || [])) patch.galleryImages = ng;
  } else if (patch.mainImage) {
    patch.galleryImages = [patch.mainImage];                  // collapse to the one uploaded image
  }
  if (Object.keys(patch).length) { await db.product.update({ where: { id: p.id }, data: patch }); pUpd++; }
}
let cUpd = 0;
for (const c of cats) if (map.has(c.image)) { await db.category.update({ where: { id: c.id }, data: { image: map.get(c.image) } }); cUpd++; }
console.log(`  DB: ${pUpd} products, ${cUpd} categories repointed.`);

// ---- 5. rewrite JSON seed source so a fresh Vercel/Postgres seed lands Blob URLs too ----
async function rewriteJson(file, apply) {
  const fp = join(ROOT, "data", file);
  if (!existsSync(fp)) return;
  const arr = JSON.parse(await readFile(fp, "utf8"));
  let n = 0;
  for (const row of arr) if (apply(row)) n++;
  await writeFile(fp, JSON.stringify(arr, null, 2));
  console.log(`  ${file}: ${n} rows repointed.`);
}
await rewriteJson("products.json", (row) => {
  let changed = false;
  if (map.has(row.image)) { row.image = map.get(row.image); changed = true; }
  if (Array.isArray(row.gallery)) {
    const ng = FULL ? row.gallery.map((g) => map.get(g) || g) : (map.has(row.image) || changed ? [row.image] : row.gallery);
    if (JSON.stringify(ng) !== JSON.stringify(row.gallery)) { row.gallery = ng; changed = true; }
  }
  return changed;
});
await rewriteJson("categories.json", (row) => {
  if (map.has(row.image)) { row.image = map.get(row.image); return true; }
  return false;
});

console.log(`\n✓ Done. Every product/category/slideshow reference now points at Vercel Blob. Restart the dev server (or redeploy) to see it.`);
await db.$disconnect();
