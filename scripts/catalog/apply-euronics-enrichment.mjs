/**
 * Apply the Euronics enrichment manifest to the catalogue.
 *
 *   (on the OCI box)  euronics_enrich.py  ->  enrich/manifest.json + enrich/catalog/...
 *   (copy both back)  public/catalog/euronics/<CODE>/01.jpg  +  manifest.json
 *   node scripts/catalog/apply-euronics-enrichment.mjs manifest.json [--dry-run]
 *
 * An image may also be a Euronics CDN link, the way import-euronics-range.mjs
 * stores them: { "CIMD91B": { "status": "ok", "image": "https://cdn.media.amplience.net/…" } }.
 *
 * Only fills in what is MISSING. A product whose image or title the owner has
 * already set is left alone — the manifest is a source of last resort, not an
 * authority. Prices are never touched here at all: that is the price-watch
 * system's job and it has guards this script does not.
 *
 * The image is only written when the file actually exists under public/ (or the
 * link answers with an image), so a half-copied download or a dead link can
 * never leave a product pointing at a 404.
 */
import { createRequire } from "module";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const DRY = process.argv.includes("--dry-run");
const file = process.argv.find((a) => a.endsWith(".json"));
if (!file) { console.error("usage: apply-euronics-enrichment.mjs <manifest.json> [--dry-run]"); process.exit(1); }

const PUBLIC = join(process.cwd(), "public");
const imageExists = async (src) => {
  if (!/^https:\/\//.test(src)) return existsSync(join(PUBLIC, src));
  try { const r = await fetch(src, { method: "HEAD" }); return r.ok && /^image\//.test(r.headers.get("content-type") || ""); }
  catch { return false; }
};
const manifest = JSON.parse(readFileSync(file, "utf8"));
const db = new PrismaClient();

let imageSet = 0, titleSet = 0, descSet = 0, missingFile = 0, untouched = 0;

for (const [code, m] of Object.entries(manifest)) {
  if (!m || m.status !== "ok") continue;
  const p = await db.product.findFirst({
    where: { productCode: code },
    // A hidden duplicate must not take the image meant for the live listing.
    orderBy: { isVisible: "desc" },
    select: { id: true, mainImage: true, title: true, descriptionText: true, shortDescription: true },
  });
  if (!p) continue;

  const patch = {};

  if (m.image && !p.mainImage) {
    if (await imageExists(m.image)) {
      patch.mainImage = m.image;
      patch.galleryImages = [m.image];
      imageSet++;
    } else {
      missingFile++;
    }
  }

  // The feed title is a terse identifier ("59.4cm Built In Electric Single
  // Oven - S"); Euronics' own name is what a shopper would recognise. Only
  // upgrade when ours is clearly the stub — never overwrite a longer one.
  if (m.title && m.title.length > (p.title || "").length + 10) {
    patch.title = m.title.slice(0, 200);
    titleSet++;
  }
  if (m.description && !(p.descriptionText || "").trim()) {
    patch.descriptionText = m.description.slice(0, 2000);
    if (!(p.shortDescription || "").trim()) patch.shortDescription = m.description.slice(0, 200);
    descSet++;
  }

  if (!Object.keys(patch).length) { untouched++; continue; }
  if (!DRY) await db.product.update({ where: { id: p.id }, data: patch });
}

console.log(`${DRY ? "DRY RUN — " : ""}images set ${imageSet}, titles improved ${titleSet}, descriptions added ${descSet}`);
console.log(`skipped: ${missingFile} image not found (no file under public/, or the link is not an image), ${untouched} already complete`);
await db.$disconnect();
