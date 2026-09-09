/**
 * Add a supplier's range as CALL-FOR-PRICE listings.
 *
 *   node scripts/catalog/import-supplier-range.mjs --supplier caple   [--dry-run] [--limit N]
 *   node scripts/catalog/import-supplier-range.mjs --supplier quooker [--dry-run]
 *
 * Different from the Euronics importer in one deliberate way: it NEVER writes a
 * price. The owner asked for both ranges "with price plz call" — these are
 * supply-and-fit lines he quotes on the phone, not shelf stock with a shown
 * price. So every product lands priceNow = null, which the storefront renders
 * as "Call for best pricing", and stays out of the Google feed (which needs a
 * price we would stand behind).
 *
 * The two sites publish very differently, so each supplier declares how to read
 * a page rather than the reader guessing:
 *   caple   — WooCommerce, clean JSON-LD Product with name/sku/image
 *   quooker — a React site with NO structured data at all; name comes from <h1>
 *
 * Matching is on sourceUrl. One supplier page is one product, whatever shape
 * its code is in — the same rule the Euronics importer had to learn.
 */
import { createRequire } from "module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classify, LEAF } from "./taxonomy.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const args = process.argv.slice(2);
const argOf = (n, d = "") => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? d) : d; };
const DRY = args.includes("--dry-run");
const LIMIT = Number(argOf("--limit", 0)) || 0;
const DELAY_MS = Number(argOf("--delay", 900)) || 900;
const RETRY_MS = Number(argOf("--retry-delay", 10000)) || 10000;
const SUPPLIER = argOf("--supplier", "").toLowerCase();

const UA = "JyotsnaElectricalBot/1.0 (+catalogue sync, Euronics member; contact rohith@kroneuszerotrust.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** Suppliers escape markup into their own metadata; decode it at the door. */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—", deg: "°", pound: "£", trade: "™", reg: "®", hellip: "…" };
function cleanText(s) {
  let t = String(s ?? "");
  for (let i = 0; i < 4; i++) {
    const d = t
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&([a-zA-Z]+);/g, (m, n) => ENT[n.toLowerCase()] ?? m);
    if (d === t) break;
    t = d;
  }
  return t.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function get(url, timeoutMs = 25000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try { const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: ac.signal }); return r.ok ? await r.text() : null; }
  catch { return null; } finally { clearTimeout(t); }
}

/** Same lenient parse the Euronics reader needs — raw newlines inside JSON-LD
 *  strings are invalid JSON, and a control character is only ever whitespace
 *  outside a string literal, so blanking them is safe either way. */
const blankCtrl = (s) => Array.from(s, (c) => (c.charCodeAt(0) < 32 ? " " : c)).join("");
const lenient = (s) => { try { return JSON.parse(s); } catch { /* repair below */ }
  try { return JSON.parse(blankCtrl(s)); } catch { return null; } };

function jsonLdProduct(html) {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let p = null;
  const walk = (o) => { if (!o || typeof o !== "object") return; const t = o["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) p = p || o; for (const k in o) walk(o[k]); };
  for (const b of blocks) { const j = lenient(b); if (j) walk(j); }
  return p;
}
const meta = (html, n) => (html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i")) || [])[1] || "";

/**
 * Caple's own section path -> our leaf. The section is a far better classifier
 * than a regex over the title: /online-shop/taps/steaming-hot-water-taps/vap2-3in1-ss/
 * says exactly what the product is, while its title ("VAP2 3-in-1 Tap") matches
 * the generic tap rule and would put all 16 boiling taps in with the mixers.
 *
 * Only sections that hold ONE kind of thing are listed. appliances/refrigeration
 * (18) and appliances/laundry (6) are deliberately absent: they are mixed
 * shelves, and TEXT_RULES already splits fridge vs freezer vs fridge-freezer and
 * washer vs washer-dryer per product, which a blanket section mapping would undo.
 *
 * sinks/waste-disposal-units is also absent on purpose -- classify() sends those
 * to Food Prep, where the shop's existing ISE MultiGrind unit already sits.
 */
const CAPLE_SECTION_LEAF = {
  "appliances/extraction": "cooker-hoods",
  "appliances/hobs": "hobs",
  "appliances/ovens": "ovens",
  "appliances/microwaves": "microwaves",
  "appliances/warming-drawers": "warming-drawers",
  "appliances/wine-coolers": "wine-coolers",
  "appliances/dishwashers": "integrated-dishwashers",
  "appliances/coffee-machines": "bean-to-cup",
  "sinks/stainless-steel": "kitchen-sinks",
  "sinks/granite": "kitchen-sinks",
  "sinks/ceramic": "kitchen-sinks",
  "taps/single-lever": "kitchen-taps",
  "taps/dual-lever": "kitchen-taps",
  "taps/pull-out": "kitchen-taps",
  "taps/pot-fillers": "kitchen-taps",
  "taps/puriti": "kitchen-taps",
  "taps/steaming-hot-water-taps": "boiling-water-taps",
};
/** "appliances/extraction" from https://www.caple.co.uk/online-shop/appliances/extraction/chimney/zel900/ */
const capleSection = (u) => (u.match(/\/online-shop\/([^/]+\/[^/]+)\//) || [])[1] || "";

const SUPPLIERS = {
  caple: {
    brand: "Caple",
    sitemaps: ["https://www.caple.co.uk/product-sitemap.xml", "https://www.caple.co.uk/product-sitemap2.xml"],
    // Spares are 734 of Caple's 1,390 pages. The owner asked for the RANGE, and
    // the shop had just been trimmed of spare-part clutter, so only the
    // sellable sections are taken. Pass --spares to include them.
    keep: (u) => !/\/online-shop\/appliances\/(splashbacks|plinth-heaters)\//.test(u)
      && (/\/online-shop\/(appliances|sinks|taps)\//.test(u) || (args.includes("--spares") && /\/online-shop\//.test(u))),
    leaf: (u) => CAPLE_SECTION_LEAF[capleSection(u)] || "",
    read: (html) => {
      const p = jsonLdProduct(html);
      if (!p) return null;
      const img = Array.isArray(p.image) ? p.image[0] : p.image;
      return {
        title: cleanText(p.name),
        code: String(p.sku || p.mpn || "").trim(),
        image: typeof img === "string" ? img : String(img?.url || ""),
        description: cleanText(p.description || meta(html, "description")),
      };
    },
  },
  quooker: {
    brand: "Quooker",
    sitemaps: ["https://www.quooker.co.uk/sitemap.xml"],
    // Exactly one path segment under /taps or /tanks. Going deeper picks up
    // support pages -- /tanks/cube/compatibility is the FAQ "Is the CUBE
    // compatible with my existing Quooker-system?", which the h1 reader
    // happily turned into a product.
    keep: (u) => /^https:\/\/www\.quooker\.co\.uk\/(taps|tanks)\/[^/]+$/.test(u),
    // No JSON-LD anywhere on the site, so the h1 is the product name. Images
    // are Contentful; the _next/image proxy URL is skipped in favour of the
    // original, which does not depend on their renderer staying up.
    read: (html) => {
      const h1 = cleanText((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "");
      if (!h1) return null;
      // Take the first RASTER image: Quooker_Logo.svg and the nav icons are all
      // SVG and sit above the product photography, so the first match without
      // this filter was the logo -- and thirteen taps shared one red rectangle.
      const img = [...new Set([...html.matchAll(/https:\/\/images\.eu\.ctfassets\.net\/[^"'\s?\\]+/g)].map((m) => m[0]))]
        .find((u) => /\.(jpg|jpeg|png|webp)$/i.test(u)) || "";
      return { title: h1, code: "", image: img, description: cleanText(meta(html, "description")) };
    },
  },
};

const cfg = SUPPLIERS[SUPPLIER];
if (!cfg) { console.error(`--supplier must be one of: ${Object.keys(SUPPLIERS).join(", ")}`); process.exit(1); }

/**
 * Download the supplier's photo into public/ instead of hotlinking it.
 *
 * Every other image on this site is served from public/catalog/<brand>/<code>/ --
 * the Vercel Blob store is suspended, and the shop got a page of blank tiles the
 * last time an off-site host was trusted. Caple's own host is not in
 * next.config.mjs either, so a stored caple.co.uk URL renders as nothing at all.
 * Their product shots are ~95KB, so the whole range is ~60MB and needs no resize.
 *
 * Returns the site-relative path, or "" if there is nothing usable to store --
 * never a URL that would 400.
 */
const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));
async function saveImage(remote, brandDir, code) {
  if (!remote || DRY) return ""; // a dry run writes nothing, files included
  const ext = (remote.split("?")[0].match(/\.(jpe?g|png|webp)$/i)?.[1] || "jpg").toLowerCase().replace("jpeg", "jpg");
  const rel = `/catalog/${brandDir}/${code}/01.${ext}`;
  const dir = `${PUBLIC_DIR}catalog/${brandDir}/${code}`;
  const abs = `${dir}/01.${ext}`;
  if (existsSync(abs)) return rel; // resumable: a re-run does not re-download
  try {
    const r = await fetch(remote, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) return "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000) return ""; // a spinner or 1px placeholder, not a product shot
    mkdirSync(dir, { recursive: true });
    writeFileSync(abs, buf);
    return rel;
  } catch { return ""; }
}

/**
 * next/image answers 400 for any host not in next.config.mjs and the product
 * renders with a broken frame -- worse than no image, because the storefront
 * already has a clean placeholder tile for a product without one. Read the
 * allowlist from the config itself so this can never drift from what the
 * renderer will actually accept.
 */
const { default: nextConfig } = await import("../../next.config.mjs");
const PATTERNS = nextConfig.images?.remotePatterns ?? [];
const renderable = (u) => {
  if (!u) return false;
  if (u.startsWith("/")) return true; // already downloaded into public/
  let host;
  try { host = new URL(u).hostname; } catch { return false; }
  return PATTERNS.some((p) => p.hostname === host || (p.hostname.startsWith("*.") && host.endsWith(p.hostname.slice(1))));
};

const db = new PrismaClient();

// ---- the supplier's range --------------------------------------------------
const urls = new Set();
for (const sm of cfg.sitemaps) {
  const xml = await get(sm, 45000);
  if (xml) for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(m[1].trim().replace(/\/$/, ""));
  await sleep(300);
}
let work = [...urls].filter(cfg.keep);
if (LIMIT) work = work.slice(0, LIMIT);
console.log(`${cfg.brand}: ${urls.size} sitemap urls, ${work.length} in range${DRY ? "  (dry run)" : ""}\n`);

// ---- what we already hold --------------------------------------------------
const existing = await db.product.findMany({ select: { id: true, slug: true, sourceUrl: true, productCode: true, brand: true } });
const norm = (u) => String(u || "").split("?")[0].replace(/\/+$/, "").toLowerCase();
const byUrl = new Map(existing.filter((p) => p.sourceUrl).map((p) => [norm(p.sourceUrl), p]));
const haveSlug = new Set(existing.map((p) => p.slug));
// Brand+code, not code alone. The shop already lists Caple WI6143BG, imported
// years ago from ruislipappliances.com, so its sourceUrl is not a caple.co.uk
// one and the url check below cannot see it -- without this the wine cooler is
// listed twice. Scoped to brand because two makers may legitimately share a code.
const brandCode = (b, c) => `${b}|${c}`.toUpperCase();
const haveBrandCode = new Set(existing.map((p) => brandCode(p.brand, p.productCode)));

let created = 0, already = 0, unreadable = 0, unclassified = 0, unusableImage = 0;
const problems = [];
const unread = [];

for (const url of work) {
  if (byUrl.has(norm(url))) { already++; continue; }

  // Caple throttles a sustained run: the first pass read ~183 pages and then
  // failed the next 458 outright, every one of which fetched fine again a few
  // minutes later. One retry after a longer pause recovers most of them; the
  // rest are listed at the end rather than vanishing into a count.
  let html = await get(url);
  let d = html ? cfg.read(html) : null;
  if (!d || !d.title) {
    await sleep(RETRY_MS);
    html = await get(url);
    d = html ? cfg.read(html) : null;
  }
  if (!d || !d.title) { unreadable++; unread.push(url); await sleep(DELAY_MS); continue; }

  // The title alone decides the category. Supplier copy names other products
  // freely, and letting it vote filed an LG washing machine under coffee.
  const named = `${cfg.brand} ${d.title}`;
  let category = "", subcategory = "";
  // Supplier section first where it is unambiguous, title rules otherwise.
  let leafId = cfg.leaf ? cfg.leaf(url) : "";
  if (!leafId) {
    try {
      leafId = classify({ name: named, description: named, source: SUPPLIER, key: d.code || url }).leaf;
    } catch { /* reported below */ }
  }
  const hit = LEAF.get(leafId);
  if (hit) { category = hit.topName; subcategory = hit.leafName; }
  if (!category) { unclassified++; problems.push(`${d.code || url.split("/").pop()}: ${d.title.slice(0, 52)}`); await sleep(DELAY_MS); continue; }

  // A supplier SKU is preferred; where there is none (Quooker publishes no
  // codes) the page slug is stable and unique, which is what a code is for.
  const code = (d.code || url.split("/").pop()).toUpperCase();
  // The code is only known once the page is read, so this skip costs one fetch --
  // cheaper than a duplicate listing, and it never renames a real supplier SKU.
  if (haveBrandCode.has(brandCode(cfg.brand, code))) { already++; await sleep(DELAY_MS); continue; }
  haveBrandCode.add(brandCode(cfg.brand, code));

  const base = slugify(`${cfg.brand}-${d.code || d.title}`) || slugify(d.title);
  let slug = base;
  for (let i = 2; haveSlug.has(slug); i++) slug = `${base}-${i}`;
  haveSlug.add(slug);

  // Prefer a downloaded copy; fall back to the remote URL only if the renderer
  // would actually accept its host (Quooker's Contentful CDN is allowlisted).
  const image = (await saveImage(d.image, slugify(cfg.brand), code)) || (renderable(d.image) ? d.image : "");
  if (d.image && !image) unusableImage++;

  if (!DRY) {
    await db.product.create({ data: {
      slug, title: d.title, brand: cfg.brand, productCode: code, gtin: "",
      category, subcategory, breadcrumbs: [category, subcategory],
      // No price, ever. These are quoted on the phone.
      priceNow: null, priceWas: null, saving: null, currency: "GBP",
      availabilityNormalised: "call_to_confirm", availabilityRaw: "",
      warranty: "", shortDescription: d.description.slice(0, 400), descriptionText: d.description,
      descriptionHtml: "", mainImage: image, galleryImages: image ? [image] : [],
      specifications: [], features: [], relatedProductCodes: [], serviceAddOns: [],
      sourceUrl: url, oldUrl: "", isVisible: true, adminOverrideFields: [],
      seoTitle: `${d.title} | ${cfg.brand}`.slice(0, 70),
      seoDescription: `${d.title}. Call 0208 864 5763 for price, availability and fitting.`.slice(0, 300),
      lastScrapedAt: new Date(),
    } });
  }
  created++;
  if (created % 50 === 0) console.log(`  …${created} created`);
  await sleep(DELAY_MS);
}

console.log(`\n===== ${cfg.brand.toUpperCase()} RANGE ${DRY ? "(DRY RUN)" : "IMPORTED"} =====`);
console.log(`  created (call for price) : ${created}`);
console.log(`  already on the site      : ${already}`);
console.log(`  page unreadable          : ${unreadable}`);
console.log(`  unclassifiable           : ${unclassified}`);
if (unusableImage) console.log(`  no usable image (download failed, host not allowlisted) : ${unusableImage}`);
if (problems.length) { console.log(`\nfirst unclassifiable:`); for (const p of problems.slice(0, 10)) console.log(`  ${p}`); }
// A run that silently loses most of the range must not read as a success.
if (unread.length) {
  console.log(`
UNREAD after one retry (${unread.length}) - re-run to pick these up:`);
  for (const u of unread.slice(0, 10)) console.log(`  ${u}`);
  if (unread.length > 10) console.log(`  ...and ${unread.length - 10} more`);
}
if (unread.length > work.length * 0.1) {
  console.error(`
FAILED: ${unread.length}/${work.length} pages unreadable - a throttle, not a finished import.`);
  process.exitCode = 1;
}
if (!DRY && created) console.log(`\nNext: recompute counts, then npm run rag:build.`);
