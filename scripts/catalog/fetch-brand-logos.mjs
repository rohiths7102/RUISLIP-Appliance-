/**
 * Pull brand logos from the CLIENT'S OWN live site (kitchen-appliances.co.uk is
 * Euronics Ruislip / Jyotsna Electrical's current website — these are their own
 * assets, the same migration as the product data).
 *
 * Sources, in order:
 *   1. logo URLs recorded in the old scrape's media-manifest.json
 *   2. any /images/brands/ URLs found on the live homepage
 *   3. filename guesses on the same CDN folder for brands still missing
 *
 * Output: public/brands/<slug>.<ext> + data/brand-logos.json (slug -> public path)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "public", "brands");
const MAP_OUT = join(process.cwd(), "data", "brand-logos.json");
mkdirSync(OUT_DIR, { recursive: true });

const brands = JSON.parse(readFileSync("data/brands.json", "utf8"));
const slugs = new Map(brands.map((b) => [b.slug, b.name]));

/* 1 — manifest URLs */
const manifest = JSON.parse(readFileSync("data/media-manifest.json", "utf8"));
const items = Array.isArray(manifest) ? manifest : manifest.items || manifest.media || [];
const urls = new Set(items.map((x) => x.sourceUrl).filter((u) => u && u.includes("/brands/")));

/* 2 — live homepage */
try {
  const html = await (await fetch("https://www.kitchen-appliances.co.uk/", { signal: AbortSignal.timeout(15000) })).text();
  for (const m of html.matchAll(/https?:\/\/[^"' )]+\/images\/brands\/[^"' )]+\.(?:png|gif|jpe?g|webp|svg)/gi)) urls.add(m[0]);
  console.log("homepage scan ok — total candidate URLs:", urls.size);
} catch (e) { console.log("homepage fetch failed (using manifest + guesses only):", e.message); }

/* normalise a URL filename to one of our brand slugs */
const toSlug = (file) => {
  const base = file.toLowerCase().replace(/\.(png|gif|jpe?g|webp|svg)$/, "").replace(/[_-]?logo[_-]?/g, "").replace(/_rgb|_red|_blue/g, "");
  const clean = base.replace(/[^a-z0-9]+/g, "");
  for (const [slug] of slugs) {
    if (clean === slug.replace(/-/g, "")) return slug;
  }
  // loose contains match (e.g. "AEG_Logo_Red_RGB" -> aeg)
  for (const [slug] of slugs) {
    const s = slug.replace(/-/g, "");
    if (s.length >= 3 && clean.includes(s)) return slug;
  }
  return null;
};

const found = new Map(); // slug -> url
for (const u of urls) {
  const slug = toSlug(u.split("/").pop());
  if (slug && !found.has(slug)) found.set(slug, u);
}

/* 3 — guess filenames for brands still missing, on the same CDN folder */
const CDN = "https://9d9b92f95c69d3713501-15e5cd540c7f9837456c62dda9d27e5a.ssl.cf3.rackcdn.com/images/brands/";
const GUESSES = {
  samsung: ["samsung.gif", "samsung.png", "Samsung-logo.jpg", "samsung.jpg"],
  sony: ["sony.jpg", "sony.gif", "sony.png", "Sony-logo.jpg"],
  haier: ["haier.gif", "haier.png", "Haier-logo.jpg"],
  ninja: ["ninja.jpg", "ninja.gif", "ninja.png", "Ninja-logo.jpg"],
  haden: ["haden.jpg", "haden.gif", "haden.png"],
  quooker: ["quooker.gif", "quooker.png", "Quooker-logo.jpg"],
  "russell-hobbs": ["russell-hobbs.gif", "russellhobbs.gif", "russell_hobbs.gif"],
  liebherr: ["liebherr.gif", "liebherr.png", "Liebherr-logo.jpg"],
  "fisher-paykel": ["fisher-paykel.gif", "fisherpaykel.gif", "fisher_paykel.gif", "fisherandpaykel.gif"],
  midea: ["midea.gif", "midea.png"],
  shark: ["shark.gif", "shark.png"],
  haden: ["haden.gif", "haden.png"],
  nutribullet: ["nutribullet.gif", "nutribullet.png"],
  sensis: ["sensis.gif", "sensis.png"],
  schonhaus: ["schonhaus.gif", "schonhaus.png", "schoenhaus.gif"],
  statesman: ["statesman.gif", "statesman.png"],
};
for (const [slug, names] of Object.entries(GUESSES)) {
  if (found.has(slug) || !slugs.has(slug)) continue;
  for (const n of names) {
    try {
      const r = await fetch(CDN + n, { method: "HEAD", signal: AbortSignal.timeout(8000) });
      if (r.ok) { found.set(slug, CDN + n); console.log("guess hit:", slug, "->", n); break; }
    } catch {}
  }
}

/* download */
const map = {};
for (const [slug, url] of found) {
  const ext = url.split(".").pop().toLowerCase().replace("jpeg", "jpg");
  const file = `${slug}.${ext}`;
  const dest = join(OUT_DIR, file);
  try {
    if (!existsSync(dest)) {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) { console.log("download failed:", slug, r.status); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 200) { console.log("too small, skipped:", slug); continue; }
      writeFileSync(dest, buf);
    }
    map[slug] = `/brands/${file}`;
    console.log("logo:", slug.padEnd(16), "->", `/brands/${file}`);
  } catch (e) { console.log("error:", slug, e.message); }
}

writeFileSync(MAP_OUT, JSON.stringify(map, null, 1));
const missing = [...slugs.keys()].filter((s) => !map[s]);
console.log(`\n${Object.keys(map).length}/${slugs.size} brand logos captured`);
console.log("no logo (typographic fallback):", missing.join(", ") || "none");
