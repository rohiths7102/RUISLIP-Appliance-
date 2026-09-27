/**
 * The homepage slideshow must be in sync with the live catalogue: every link
 * on it opens a real page that lists products.
 *
 * Since the owner's brand slides (Admin → Homepage, one per brand) replaced the
 * per-product slides, the slides link to brand pages and filtered listings
 * rather than single products with a price, so "price on slide = price on page"
 * no longer applies; a dead or empty link is what can still go wrong.
 *
 * NB: React SSR interleaves `<!-- -->` comment nodes around interpolations, so
 * all text extraction strips comments first.
 */
const BASE = process.argv[2] || "http://localhost:3005";

const strip = (html) => html.replace(/<!--.*?-->/g, "");
const home = strip(await (await fetch(BASE + "/")).text());

const carousel = home.split('aria-roledescription="carousel"')[1]?.split("</section>")[0];
if (!carousel) { console.log("FAIL: carousel not found on home page"); process.exit(1); }

const links = [...new Set([...carousel.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))];
console.log(`slideshow links found: ${links.length}`);
let pass = 0;
for (const link of links) {
  const r = await fetch(BASE + link);
  const page = await r.text();
  // A listing or product page carries product links; a brand page with nothing on it is a dead end.
  const ok = r.status === 200 && /href="\/products\/[a-z0-9.\-]+"/.test(page);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${link}${ok ? "" : `  (HTTP ${r.status}${r.status === 200 ? ", no products on the page" : ""})`}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${links.length} slideshow links open a page with products`);
process.exitCode = pass === links.length && links.length > 0 ? 0 : 1;
