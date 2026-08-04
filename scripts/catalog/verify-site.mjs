/**
 * End-to-end sweep against a running server: every category, every brand, and a
 * sample of product pages from every leaf. Checks HTTP status, that the phone
 * number is present (this site's whole purpose), and that no cart language leaked.
 *
 * Usage: node scripts/catalog/verify-site.mjs [baseUrl]
 */
import { readFileSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:3005";
const PHONE = "0208 864 5763";
// The JSON is the raw catalogue; the LIVE site hides owner-retired brands
// (Ninja/Shark, Aug 2026) whose PDPs correctly 404 — sample visible stock only.
const RETIRED = new Set(["Ninja", "Shark"]);
const products = JSON.parse(readFileSync("data/products.json", "utf8")).filter((p) => !RETIRED.has(p.brand));
const categories = JSON.parse(readFileSync("data/categories.json", "utf8"));
const brands = JSON.parse(readFileSync("data/brands.json", "utf8")).filter((b) => !RETIRED.has(b.name));

const fails = [];
let checked = 0;

async function check(path, { needCode } = {}) {
  checked++;
  let res, html;
  try {
    res = await fetch(BASE + path);
    html = await res.text();
  } catch (e) {
    fails.push(`${path} — fetch failed: ${e.message}`);
    return;
  }
  if (res.status !== 200) { fails.push(`${path} — HTTP ${res.status}`); return; }
  if (!html.includes(PHONE)) fails.push(`${path} — phone number missing`);
  if (/add to basket|add to cart|proceed to checkout|buy now/i.test(html)) fails.push(`${path} — CART LANGUAGE`);
  if (needCode && !html.includes(needCode)) fails.push(`${path} — product code ${needCode} not rendered`);
}

// static pages
for (const p of ["/", "/products", "/categories", "/brands", "/about", "/contact", "/delivery-services"]) await check(p);

// every category (9 top + 47 leaves)
for (const c of categories) await check(`/categories/${c.id}`);

// every brand
for (const b of brands) await check(`/brands/${b.slug}`);

// one product from every leaf + a spread of others
const seen = new Set();
const sample = [];
for (const c of categories.filter((x) => x.parentCategory)) {
  const p = products.find((x) => x.subcategory === c.name);
  if (p && !seen.has(p.id)) { seen.add(p.id); sample.push(p); }
}
for (let i = 0; i < products.length; i += 37) {
  const p = products[i];
  if (!seen.has(p.id)) { seen.add(p.id); sample.push(p); }
}
for (const p of sample) await check(`/products/${p.id}`, { needCode: p.productCode });

// a URL that must 404 cleanly
const r = await fetch(BASE + "/products/definitely-not-a-real-product");
if (r.status !== 404) fails.push(`/products/<bogus> returned ${r.status}, expected 404`);
checked++;

console.log(`\nChecked ${checked} routes (${categories.length} categories, ${brands.length} brands, ${sample.length} products)`);
if (fails.length) {
  console.log(`\n${fails.length} FAILURES:`);
  for (const f of fails.slice(0, 40)) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("All routes 200, phone present on every page, no cart language, 404 works.");
