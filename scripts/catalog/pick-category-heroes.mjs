/**
 * Choose a hero shot for each department panel on the homepage.
 *
 * The panels put the appliance on the shop's blue, so the shot has to be a
 * cutout — a catalogue photo shot on white shows up as a white box on the blue.
 * Roughly one image in six is a cutout, so this picks, per department, the
 * dearest visible product whose image has transparent corners, and writes
 * data/category-heroes.json for app/page.tsx to read.
 *
 *   node scripts/catalog/pick-category-heroes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));
const OUT = fileURLToPath(new URL("../../data/category-heroes.json", import.meta.url));

/** Transparent in at least 5 of the 6 edge samples = a cutout, not a plate. */
async function isCutout(rel) {
  const f = path.join(PUBLIC_DIR, rel.replace(/^\//, ""));
  if (!fs.existsSync(f)) return false;
  try {
    const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x, y) => data[(y * info.width + x) * info.channels + 3];
    const pts = [[2, 2], [info.width - 3, 2], [2, info.height - 3], [info.width - 3, info.height - 3],
                 [2, info.height >> 1], [info.width - 3, info.height >> 1]];
    return pts.filter(([x, y]) => at(x, y) < 12).length >= 5;
  } catch { return false; }
}

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();
const cats = await db.category.findMany({ where: { parentId: null }, select: { id: true, name: true, image: true } });

const heroes = {};
for (const c of cats) {
  const candidates = await db.product.findMany({
    where: { category: c.name, isVisible: true, mainImage: { not: "" } },
    select: { productCode: true, mainImage: true, priceNow: true },
    orderBy: { priceNow: "desc" },
    take: 60,
  });
  let picked = null;
  for (const p of candidates) {
    if (await isCutout(p.mainImage)) { picked = p; break; }
  }
  if (picked) heroes[c.id] = picked.mainImage;
  console.log(`${c.id.padEnd(20)} ${picked ? `${picked.productCode} ${picked.mainImage}` : "— no cutout, keeps its catalogue shot"}`);
}

fs.writeFileSync(OUT, JSON.stringify(heroes, null, 2) + "\n");
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${Object.keys(heroes).length}/${cats.length} departments)`);
await db.$disconnect();
