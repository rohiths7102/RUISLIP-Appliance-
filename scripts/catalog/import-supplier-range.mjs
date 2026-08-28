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
import { classify, LEAF } from "./taxonomy.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const args = process.argv.slice(2);
const argOf = (n, d = "") => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? d) : d; };
const DRY = args.includes("--dry-run");
const LIMIT = Number(argOf("--limit", 0)) || 0;
const DELAY_MS = Number(argOf("--delay", 900)) || 900;
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

const SUPPLIERS = {
  caple: {
    brand: "Caple",
    sitemaps: ["https://www.caple.co.uk/product-sitemap.xml", "https://www.caple.co.uk/product-sitemap2.xml"],
    // Spares are 734 of Caple's 1,390 pages. The owner asked for the RANGE, and
    // the shop had just been trimmed of spare-part clutter, so only the
    // sellable sections are taken. Pass --spares to include them.
    keep: (u) => /\/online-shop\/(appliances|sinks|taps)\//.test(u) || (args.includes("--spares") && /\/online-shop\//.test(u)),
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
    keep: (u) => /\/(taps|tanks)\//.test(u),
    // No JSON-LD anywhere on the site, so the h1 is the product name. Images
    // are Contentful; the _next/image proxy URL is skipped in favour of the
    // original, which does not depend on their renderer staying up.
    read: (html) => {
      const h1 = cleanText((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "");
      if (!h1) return null;
      const img = (html.match(/https:\/\/images\.eu\.ctfassets\.net\/[^"'\s?]+/) || [])[0] || "";
      return { title: h1, code: "", image: img, description: cleanText(meta(html, "description")) };
    },
  },
};

const cfg = SUPPLIERS[SUPPLIER];
if (!cfg) { console.error(`--supplier must be one of: ${Object.keys(SUPPLIERS).join(", ")}`); process.exit(1); }

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
const existing = await db.product.findMany({ select: { id: true, slug: true, sourceUrl: true, productCode: true } });
const norm = (u) => String(u || "").split("?")[0].replace(/\/+$/, "").toLowerCase();
const byUrl = new Map(existing.filter((p) => p.sourceUrl).map((p) => [norm(p.sourceUrl), p]));
const haveSlug = new Set(existing.map((p) => p.slug));
const haveCode = new Set(existing.map((p) => String(p.productCode).toUpperCase()));

let created = 0, already = 0, unreadable = 0, unclassified = 0;
const problems = [];

for (const url of work) {
  if (byUrl.has(norm(url))) { already++; continue; }

  const html = await get(url);
  const d = html ? cfg.read(html) : null;
  if (!d || !d.title) { unreadable++; await sleep(DELAY_MS); continue; }

  // The title alone decides the category. Supplier copy names other products
  // freely, and letting it vote filed an LG washing machine under coffee.
  const named = `${cfg.brand} ${d.title}`;
  let category = "", subcategory = "";
  try {
    const { leaf } = classify({ name: named, description: named, source: SUPPLIER, key: d.code || url });
    const hit = LEAF.get(leaf);
    if (hit) { category = hit.topName; subcategory = hit.leafName; }
  } catch { /* reported below */ }
  if (!category) { unclassified++; problems.push(`${d.code || url.split("/").pop()}: ${d.title.slice(0, 52)}`); await sleep(DELAY_MS); continue; }

  // A supplier SKU is preferred; where there is none (Quooker publishes no
  // codes) the page slug is stable and unique, which is what a code is for.
  let code = (d.code || url.split("/").pop()).toUpperCase();
  if (haveCode.has(code)) code = `${code}-${slugify(cfg.brand).toUpperCase()}`;
  haveCode.add(code);

  const base = slugify(`${cfg.brand}-${d.code || d.title}`) || slugify(d.title);
  let slug = base;
  for (let i = 2; haveSlug.has(slug); i++) slug = `${base}-${i}`;
  haveSlug.add(slug);

  if (!DRY) {
    await db.product.create({ data: {
      slug, title: d.title, brand: cfg.brand, productCode: code, gtin: "",
      category, subcategory, breadcrumbs: [category, subcategory],
      // No price, ever. These are quoted on the phone.
      priceNow: null, priceWas: null, saving: null, currency: "GBP",
      availabilityNormalised: "call_to_confirm", availabilityRaw: "",
      warranty: "", shortDescription: d.description.slice(0, 400), descriptionText: d.description,
      descriptionHtml: "", mainImage: d.image || "", galleryImages: d.image ? [d.image] : [],
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
if (problems.length) { console.log(`\nfirst unclassifiable:`); for (const p of problems.slice(0, 10)) console.log(`  ${p}`); }
if (!DRY && created) console.log(`\nNext: recompute counts, then npm run rag:build.`);
