import assert from "node:assert";
import { parsePrice, cleanWarranty, toSlug, newProductSlug, normaliseAvailability } from "./normalise.js";
import { extractProductCards } from "./extractProduct.js";
import { extractBrands } from "./extractBrand.js";

let pass = 0;
const ok = (c: boolean, m: string) => { assert.ok(c, m); console.log("  ✓", m); pass++; };

ok(parsePrice("Our price £1,049.00") === 1049, "parsePrice handles thousands");
ok(parsePrice("Was £309.99") === 309.99, "parsePrice decimals");
ok(parsePrice("") === null, "parsePrice empty -> null");
ok(cleanWarranty("5 Year Warranty test") === "5 Year Warranty", "cleanWarranty strips trailing test");
ok(normaliseAvailability("Awaiting stock") === "awaiting_stock", "availability awaiting");
ok(normaliseAvailability("") === "call_to_confirm", "availability empty -> call_to_confirm");
ok(normaliseAvailability("This product is not available to buy online") === "call_to_confirm", "not-online -> call");
ok(toSlug("Bosch WAN28258GB 8kg") === "bosch-wan28258gb-8kg", "toSlug");
ok(newProductSlug("Bosch Oven", "HBS534BS0B").startsWith("/products/"), "newProductSlug prefix");

const cardHtml = `<ul><li>
  <a href="/bosch-wan28258gb-8kg-1400-spin-washing-machine---white/p-7320"><img src="https://x.ssl.cf3.rackcdn.com/images/products/BOSWAN28258GB_1_278_278.png" alt="Bosch WAN28258GB"></a>
  <h4>Bosch WAN28258GB 8kg 1400 Spin Washing Machine - White 5 Year Warranty test</h4>
  Was £479.00 Save £30.00 Our price £449.00
</li></ul>`;
const cards = extractProductCards(cardHtml, "https://www.kitchen-appliances.co.uk/");
ok(cards.length === 1, "extractProductCards finds 1 card");
ok(cards[0].sourceUrl!.endsWith("/p-7320"), "card sourceUrl");
ok(cards[0].priceNow === 449, "card priceNow 449");
ok(cards[0].priceWas === 479, "card priceWas 479");
ok(cards[0].saving === 30, "card saving 30");

const brandHtml = `<div>
  <a href="/search?q=Bosch"><img src="https://x.ssl.cf3.rackcdn.com/images/brands/bosch.gif" alt="Bosch"></a>
  <a href="/brands/Miele"><img src="https://x.ssl.cf3.rackcdn.com/images/brands/Miele.jpg" alt="Miele"></a>
</div>`;
const bs = extractBrands(brandHtml);
ok(bs.length === 2, "extractBrands finds 2");
ok(bs.some((b) => b.name === "Bosch" && b.logo.includes("bosch.gif")), "brand Bosch + logo");

console.log(`\n${pass} assertions passed`);
