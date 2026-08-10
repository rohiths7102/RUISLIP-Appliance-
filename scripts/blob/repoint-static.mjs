/**
 * The INVERSE of upload-images.mjs: repoint every image reference OFF Vercel Blob
 * and back onto app-served /catalog/... static paths.
 *
 * Why this exists: the Blob store can be suspended (free-tier usage exceeded), and
 * while it is, every catalogue image 403s ("Your store is blocked") and the
 * storefront renders blank tiles. Serving the ~1.6k primary images from public/
 * puts them on the deployment's own CDN quota instead of the Blob store's.
 *
 * Rewrites, wherever the value is a URL on *.public.blob.vercel-storage.com whose
 * path exists under public/:
 *   DB    product.mainImage, product.galleryImages, category.image
 *   JSON  data/products.json (image, gallery), data/categories.json (image)
 *
 * A reference whose file is missing on disk is left untouched and reported —
 * better a known 403 than a certain 404.
 *
 * Modes:
 *   --dry-run     report what would change, write nothing.
 *   --json-only   rewrite the seed JSON but leave the DB alone.
 *
 * Runs against whatever DATABASE_URL points at, same as its sibling:
 *   local sqlite:  node scripts/blob/repoint-static.mjs
 *   production:    node scripts/db/engine.mjs client:pg   (once), then
 *                  PRISMA_CLIENT_DIR=.prisma-pg/client node scripts/db/with-prod-db.mjs scripts/blob/repoint-static.mjs
 *
 * Reverting to Blob later (store unsuspended / plan upgraded) is the existing
 * flow: npm run blob:sync — it only touches /catalog/ references, i.e. exactly
 * the ones this script restores.
 */
import { createRequire } from "module";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
// PRISMA_CLIENT_DIR lets this run against the isolated Postgres client without
// touching the default sqlite one (see scripts/db/engine.mjs client:pg).
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

for (const f of [".env.local", ".env"]) {
  const fp = join(process.cwd(), f);
  if (!existsSync(fp)) continue;
  for (const line of readFileSync(fp, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const DRY = process.argv.includes("--dry-run");
const JSON_ONLY = process.argv.includes("--json-only");
const ROOT = process.cwd();
const PUBLIC = join(ROOT, "public");
const BLOB_RE = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com(\/.+)$/i;

const missing = new Set();
/** Blob URL -> local "/catalog/…" path, or null if not a blob URL / file absent. */
function toLocal(v) {
  const m = typeof v === "string" ? v.match(BLOB_RE) : null;
  if (!m) return null;
  const rel = decodeURIComponent(m[1]);
  if (!existsSync(join(PUBLIC, rel))) { missing.add(rel); return null; }
  return rel;
}

console.log(`=== Repoint images Blob -> local static ${DRY ? "(DRY RUN)" : ""} ${JSON_ONLY ? "[JSON only]" : ""} ===`);

// ---- seed JSON ----
async function rewriteJson(file, apply) {
  const fp = join(ROOT, "data", file);
  if (!existsSync(fp)) return;
  const arr = JSON.parse(await readFile(fp, "utf8"));
  let n = 0;
  for (const row of arr) if (apply(row)) n++;
  if (!DRY && n) await writeFile(fp, JSON.stringify(arr, null, 2));
  console.log(`  ${file}: ${n} rows repointed${DRY ? " (would be)" : ""}.`);
}
await rewriteJson("products.json", (row) => {
  let changed = false;
  const li = toLocal(row.image);
  if (li) { row.image = li; changed = true; }
  if (Array.isArray(row.gallery)) {
    const ng = row.gallery.map((g) => toLocal(g) || g);
    if (JSON.stringify(ng) !== JSON.stringify(row.gallery)) { row.gallery = ng; changed = true; }
  }
  return changed;
});
await rewriteJson("categories.json", (row) => {
  const li = toLocal(row.image);
  if (li) { row.image = li; return true; }
  return false;
});

// ---- DB ----
if (!JSON_ONLY) {
  const db = new PrismaClient();
  const products = await db.product.findMany({ select: { id: true, slug: true, mainImage: true, galleryImages: true } });
  const cats = await db.category.findMany({ select: { id: true, slug: true, image: true } });
  let pUpd = 0, cUpd = 0;
  for (const p of products) {
    const patch = {};
    const li = toLocal(p.mainImage);
    if (li) patch.mainImage = li;
    // Json column: an array from the client, but tolerate the string-serialized
    // form the same way lib/repo.ts does.
    let gallery = p.galleryImages;
    if (typeof gallery === "string") { try { gallery = JSON.parse(gallery); } catch { gallery = []; } }
    if (!Array.isArray(gallery)) gallery = [];
    const ng = gallery.map((g) => toLocal(g) || g);
    if (JSON.stringify(ng) !== JSON.stringify(gallery)) patch.galleryImages = ng;
    if (Object.keys(patch).length) {
      if (!DRY) await db.product.update({ where: { id: p.id }, data: patch });
      pUpd++;
    }
  }
  for (const c of cats) {
    const li = toLocal(c.image);
    if (li) {
      if (!DRY) await db.category.update({ where: { id: c.id }, data: { image: li } });
      cUpd++;
    }
  }
  console.log(`  DB: ${pUpd}/${products.length} products, ${cUpd}/${cats.length} categories repointed${DRY ? " (would be)" : ""}.`);
  await db.$disconnect();
}

if (missing.size) {
  console.log(`\n⚠ ${missing.size} referenced files NOT on disk — left on Blob, will still 403:`);
  for (const m of [...missing].slice(0, 10)) console.log(`   ${m}`);
  if (missing.size > 10) console.log(`   … and ${missing.size - 10} more`);
} else {
  console.log(`\n✓ Every repointed reference has its file under public/.`);
}
if (DRY) console.log(`\nDRY RUN — nothing written. Re-run without --dry-run to apply.`);
else console.log(`\n✓ Done. Make sure the images themselves ship with the deployment (see .gitignore) and redeploy.`);
