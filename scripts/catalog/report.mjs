/** Catalogue health report: distribution, source balance, data gaps. */
import { readFileSync } from "node:fs";
import { TREE } from "./taxonomy.mjs";
const P = JSON.parse(readFileSync("data/products.json", "utf8"));

const pad = (s, n) => String(s).padEnd(n);
console.log(`TOTAL ${P.length} products\n`);
console.log(pad("leaf", 34) + pad("n", 6) + pad("bosch", 7) + pad("neff", 6) + pad("ruislip", 8) + "no-price  no-img");
console.log("-".repeat(78));
for (const t of TREE) {
  const top = P.filter((p) => p.category === t.name);
  console.log(`\n${t.name.toUpperCase()}  (${top.length})`);
  for (const c of t.children) {
    const xs = P.filter((p) => p.subcategory === c.name);
    if (!xs.length) { console.log("  " + pad(c.name, 32) + pad(0, 6) + "   — EMPTY"); continue; }
    const s = (k) => xs.filter((x) => x.meta.source === k).length;
    console.log(
      "  " + pad(c.name, 32) + pad(xs.length, 6) + pad(s("bosch"), 7) + pad(s("neff"), 6) + pad(s("ruislip"), 8) +
      pad(xs.filter((x) => x.priceNow === null).length, 10) + xs.filter((x) => !x.image).length
    );
  }
}

console.log("\n\n=== data gaps ===");
console.log("no price :", P.filter((p) => p.priceNow === null).length);
console.log("no image :", P.filter((p) => !p.image).length);
for (const p of P.filter((x) => !x.image)) console.log("   ", p.id, "|", p.title.slice(0, 60));

console.log("\n=== implausible prices (accessory > £500) ===");
for (const p of P.filter((x) => x.category === "Accessories & Spare Parts" && (x.priceNow ?? 0) > 500).sort((a, b) => b.priceNow - a.priceNow))
  console.log("   £" + String(p.priceNow).padEnd(9), p.brand.padEnd(6), p.title.slice(0, 58));
