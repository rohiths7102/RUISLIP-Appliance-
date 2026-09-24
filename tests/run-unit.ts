import assert from "node:assert";
import { gbp, availabilityLabel, telHref } from "../lib/format.js";
import { slugOf, poaNamesFrom } from "../lib/select.js";
import { isPoaProduct } from "../lib/poa.js";
import { productDoc, buildDocuments, faqDocs } from "../lib/rag/documents.js";
import { retrieve } from "../lib/rag/retriever.js";
import { buildSystemPrompt, factsBlock, sourcesFor, plainReply } from "../lib/chat/prompt.js";
import * as seed from "../lib/data.js";

let n = 0; const ok = (c: boolean, m: string) => { assert.ok(c, m); console.log("  ✓", m); n++; };

// format helpers
ok(gbp(279.99) === "£279.99", "gbp formats currency");
// A missing price must never render as £0 / blank — it has to send them to the phone.
ok(/call/i.test(gbp(null)) && !/0/.test(gbp(null)), "gbp(null) is phone-first, never a number");
ok(availabilityLabel("call_to_confirm").toLowerCase().includes("call to confirm"), "availability label is phone-first");
ok(["in_stock", "limited", "awaiting_stock", "call_to_confirm", "unavailable", "unknown"]
  .every((a) => /call/i.test(availabilityLabel(a as any))), "every availability state still tells them to call");
ok(telHref("0208 864 5763") === "tel:02088645763", "telHref strips non-digits");
// slug
ok(slugOf({ newSlug: "/products/foo-bar" } as any) === "foo-bar", "slugOf strips prefix");
// call-for-price: category names and brand names share one set
const poaSet = poaNamesFrom([{ name: "Hobs", priceOnApplication: false }], [{ name: "Siemens", priceOnApplication: true }, { name: "Bosch", priceOnApplication: false }]);
ok(poaSet.has("Siemens") && !poaSet.has("Bosch"), "a flagged brand joins the call-for-price set; an unflagged one does not");
ok(isPoaProduct(poaSet, { category: "Hobs", subcategory: "", brand: "Siemens" }), "a Siemens product is call-for-price by brand alone");
ok(!isPoaProduct(poaSet, { category: "Hobs", subcategory: "", brand: "Bosch" }), "a Bosch hob keeps its price");
ok(poaNamesFrom([], []).has("Siemens"), "with no brand information at all, Siemens stays masked");
ok(!poaNamesFrom([], [{ name: "Siemens", priceOnApplication: false }]).has("Siemens"), "the owner unticking Siemens wins over the fallback");
// rag documents
const pd = productDoc(seed.products[0]);
ok(pd.content.includes(seed.products[0].productCode), "productDoc includes product code");
// Take a product that HAS a published price: the seed leads with a call-for-price
// accessory whose price is deliberately scrubbed, so products[0] proves nothing here.
const priced = seed.products.find((p) => p.priceNow != null)!;
ok(/£/.test(productDoc(priced).content), "productDoc includes price when one is published");
// The other half of the owner's rule: a withheld price must never reach the bot.
ok(!/£/.test(productDoc(priced, { omitPrice: true }).content), "productDoc omits price for call-for-price products");
const docs = buildDocuments(seed as any);
// A brand the owner sells call-for-price reaches the bot with no number attached
// (data/brands.json flags Siemens; the seed still holds its prices, so this is not vacuous).
const siemensCodes = new Set(seed.products.filter((p) => p.brand === "Siemens").map((p) => p.productCode));
ok(seed.products.some((p) => p.brand === "Siemens" && p.priceNow != null), "seed still carries Siemens prices to mask");
const siemensDocs = docs.filter((d) => d.sourceType === "product" && siemensCodes.has(d.sourceId));
ok(siemensDocs.length > 0 && siemensDocs.every((d) => !/£\d/.test(d.content)), "Siemens product docs carry no price for the chatbot");
ok(docs.length > seed.products.length, "buildDocuments adds category/brand/business/faq docs");
ok(faqDocs(seed.business).some((f) => /call/i.test(f.content) && f.content.includes(seed.business.phone)), "how-to-buy FAQ is phone-first");
// retriever
const rdocs = docs as any;
ok(retrieve("WAN28258GB", rdocs, 5)[0]?.doc.metadata?.productCode === "WAN28258GB", "retrieve: exact product code ranks first");
ok(retrieve("opening hours", rdocs, 5).slice(0, 3).some((h: any) => h.doc.sourceId === "hours"), "retrieve: opening hours");
ok(retrieve("do you deliver", rdocs, 5).slice(0, 3).some((h: any) => h.doc.sourceId === "delivery"), "retrieve: delivery (prefix match)");
// chat prompt
const sp = buildSystemPrompt(seed.business);
ok(/never/i.test(sp) && sp.includes(seed.business.phone), "system prompt: no-fabrication + phone");
// chat facts and links (lib/chat/prompt.ts)
const fact = { code: "WAN28258GB", name: "Bosch Serie 4 washing machine", brand: "Bosch", department: "Washing Machines", price: 499, was: null, saving: null,
  callForPrice: false, availability: "", warranty: "", url: "/products/bosch-wan28258gb", specs: "", about: "", why: "exact code match" };
const found: any = { products: [fact], codes: [], range: null, knowledge: [], understood: {}, searched: true };
ok(factsBlock(found).includes("£499.00") && factsBlock(found).includes("WAN28258GB"), "facts carry the live price, to the penny, and the code");
ok(!/£/.test(factsBlock({ ...found, products: [{ ...fact, price: null, callForPrice: true }] })), "a call-for-price product reaches the model with no number");
ok(/closest listed codes: WGG254Z1GB/i.test(factsBlock({ ...found, codes: [{ asked: "WGG254Z0GB", status: "near", codes: ["WGG254Z1GB"] }] })), "an unlisted code is said so, with the nearest listed code");
ok(sourcesFor("Bosch Serie 4 — WAN28258GB — £499.00", found)[0]?.url === "/products/bosch-wan28258gb", "links: the product the reply named");
ok(sourcesFor("Hello, what are you looking for?", found).length === 0, "links: none when the reply names no product");
ok(plainReply(found, "0208 864 5763").includes("WAN28258GB — £499.00"), "the plain fallback reply is the facts");

// ---- catalogue integrity ----------------------------------------------------
// These lock in the properties the build script guarantees. If a future re-scrape
// breaks one, it should fail here rather than on the shop floor.
const all = seed.products as any[];
ok(all.length > 1500, `catalogue is fully loaded (${all.length} products)`);
ok(new Set(all.map((p) => p.id)).size === all.length, "every product slug is unique");
ok(all.every((p) => p.productCode), "every product has a product code to quote on the phone");
ok(all.every((p) => p.category && p.subcategory), "every product is filed under a category and subcategory");
ok(all.every((p) => p.priceNow === null || p.priceNow > 0), "no product has a zero or negative price");

// The same BSH part number ships under both the Bosch and Neff feeds; both twins
// must land in the same leaf or the catalogue contradicts itself.
const byCode = new Map<string, Set<string>>();
for (const p of all) {
  const k = p.productCode.toUpperCase();
  if (!byCode.has(k)) byCode.set(k, new Set());
  byCode.get(k)!.add(p.subcategory);
}
const divergent = [...byCode.entries()].filter(([, s]) => s.size > 1);
ok(divergent.length === 0, `cross-feed twins agree on category (${byCode.size} codes checked)`);

// No cart, ever.
ok(!all.some((p) => /add to basket|checkout|buy now/i.test(p.title)), "no checkout language in the catalogue");

console.log(`\n${n} unit assertions passed`);
