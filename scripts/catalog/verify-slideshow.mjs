/**
 * The homepage slideshow must be perfectly in sync with the live catalogue:
 * every slide's link resolves to a real product page, and the price + product
 * code shown on THAT slide appear on THAT product page (both read the same DB;
 * this proves it end-to-end over HTTP).
 *
 * NB: React SSR interleaves `<!-- -->` comment nodes around interpolations, so
 * all text extraction strips comments first.
 */
const BASE = process.argv[2] || "http://localhost:3005";

const strip = (html) => html.replace(/<!--.*?-->/g, "");
const home = strip(await (await fetch(BASE + "/")).text());

const carousel = home.split('aria-roledescription="carousel"')[1]?.split("</section>")[0];
if (!carousel) { console.log("FAIL: carousel not found on home page"); process.exit(1); }

// one block per slide, keyed by its link
const blocks = carousel.split(/href="(\/products\/[a-z0-9.\-]+)"/).slice(1);
const slides = [];
for (let i = 0; i < blocks.length; i += 2) {
  const link = blocks[i];
  const body = blocks[i + 1] || "";
  const code = (body.match(/Code ([A-Za-z0-9.\-\/]+)/) || [])[1];
  const price = (body.match(/£[\d,]+(?:\.\d{2})?/) || [])[0];
  slides.push({ link, code, price });
}

console.log(`slides found: ${slides.length}`);
let pass = 0;
for (const s of slides) {
  const r = await fetch(BASE + s.link);
  const page = strip(await r.text());
  const okStatus = r.status === 200;
  const codeOk = !!s.code && page.includes(s.code);
  const priceOk = !!s.price && page.includes(s.price);
  const ok = okStatus && codeOk && priceOk;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${s.link.padEnd(34)} code=${s.code || "?"} price=${s.price || "?"}${ok ? "" : `  (HTTP ${r.status} code:${codeOk} price:${priceOk})`}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${slides.length} slides verified: link resolves + price & code match the product page`);
if (pass !== slides.length || slides.length < 6) process.exit(1);
