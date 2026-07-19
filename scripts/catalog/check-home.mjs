/** The home page must showcase real appliances, never spare parts. */
import { readFileSync } from "node:fs";
const BASE = process.argv[2] || "http://localhost:3005";
const P = JSON.parse(readFileSync("data/products.json", "utf8"));
const bySlug = new Map(P.map((p) => [p.id, p]));

const html = await (await fetch(BASE + "/")).text();
const slugs = [...new Set([...html.matchAll(/href="\/products\/([a-z0-9-]+)"/g)].map((m) => m[1]))];
const shown = slugs.map((s) => bySlug.get(s)).filter(Boolean);

console.log("Featured shelf on the home page:");
for (const p of shown) {
  console.log(`  ${p.category.padEnd(20)} ${("£" + p.priceNow).padEnd(10)} ${p.brand.padEnd(9)} ${p.title.slice(0, 46)}`);
}
const junk = shown.filter((p) => p.category === "Accessories & Spare Parts");
console.log(`\nreal appliances: ${shown.length - junk.length} / ${shown.length}`);
console.log(junk.length ? `PROBLEM: ${junk.length} spare parts on the shelf` : "good — no spare parts fronting the shop");
if (junk.length) process.exit(1);
