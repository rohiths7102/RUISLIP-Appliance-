import assert from "node:assert";
import { gbp, availabilityLabel, telHref, waChatHref } from "../lib/format.js";
import { slugOf, poaNamesFrom } from "../lib/select.js";
import { isPoaProduct } from "../lib/poa.js";
import { productDoc, buildDocuments, faqDocs } from "../lib/rag/documents.js";
import { retrieve } from "../lib/rag/retriever.js";
import { buildSystemPrompt, factsBlock, sourcesFor, plainReply } from "../lib/chat/prompt.js";
import * as seed from "../lib/data.js";
import { evaluateGuards } from "../lib/price-watch/guards.js";
import { changeBudget } from "../lib/price-watch/auto-apply.js";
import { parsePriceList } from "../lib/price-list.js";
import { NoSearchConsoleAccess, searchConsoleSite } from "../lib/search-console.js";
import { INDEXNOW_KEY, indexNow } from "../lib/indexnow.js";
import { readFileSync } from "node:fs";
import { zipSync } from "fflate";

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

// ---- price sync: Euronics is the member price --------------------------------
// A line Euronics sells follows Euronics, cost on file or not; any other source
// still needs a cost floor; the scraper sanity check still holds a wild move.
const guard = (sourceId: string, current: number, proposed: number) => evaluateGuards({
  proposal: { productId: "p", currentPrice: current, proposedPrice: proposed, sourceId, sourceKind: "authorised", sourceAllowsAutoApply: true,
    observation: { price: proposed, deliveryCost: null, inStock: true, includesVat: true, matchConfidence: 1, status: "ok", sourceUrl: "https://www.euronics.co.uk/x", observedAt: new Date() } },
  product: { costPrice: null, floorPrice: null, category: "Washing Machines", subcategory: "Washing Machines", isPoa: false },
});
ok(guard("euronics", 449, 529).blocking.length === 0, "a Euronics price applies to a line with no cost on file");
ok(guard("cih", 449, 529).blocking.includes("no_floor_data"), "any other source still needs a cost floor");
ok(guard("euronics", 449, 1049).blocking.includes("implausible_move"), "a move over 50% still waits for a person");
ok(changeBudget(3000) === 750 && changeBudget(200) === 100 && changeBudget(3000, 40) === 40, "the change budget is a quarter of the run, never under 100, lowered only on request");

// ---- the Euronics price list upload (lib/price-list.ts) ------------------------
// Columns found by header, not position: here they are shuffled, a decoy sheet
// comes first, and "Current"/"Previous" B2C columns sit beside the real one.
const sst = ["EAN", "Previous B2C Price", "Model Number", "B2B Price", "B2C Agency Price", "Current B2C Price", "Future B2C Agency Price",
  "Future B2C Agency Price Start Date", "Stock type (central or agency)", "ABC-123", "AGENCY", "XYZ9", "CENTRAL"];
const si = sst.map((s) => `<si><t>${s}</t></si>`).join("");
const cell = (ref: string, v: string | number) => (typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${sst.indexOf(v)}</v></c>`);
const sheetXml = (rows: (string | number | null)[][]) => `<worksheet><sheetData>${rows.map((r, i) =>
  `<row r="${i + 1}">${r.map((v, j) => (v === null ? "" : cell(`${String.fromCharCode(65 + j)}${i + 1}`, v))).join("")}</row>`).join("")}</sheetData></worksheet>`;
const enc = (s: string) => new TextEncoder().encode(s);
const book = zipSync({
  "xl/workbook.xml": enc(`<workbook><sheets><sheet name="Yday" sheetId="1" r:id="rId1"/><sheet name="Full Data" sheetId="2" r:id="rId2"/></sheets></workbook>`),
  "xl/_rels/workbook.xml.rels": enc(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`),
  "xl/sharedStrings.xml": enc(`<sst>${si}</sst>`),
  "xl/worksheets/sheet1.xml": enc(sheetXml([["Model Number", "B2C Agency Price"], ["ABC-123", 1]])),
  "xl/worksheets/sheet2.xml": enc(sheetXml([
    ["EAN", "Previous B2C Price", "Model Number", "B2B Price", "B2C Agency Price", "Current B2C Price", "Future B2C Agency Price", "Future B2C Agency Price Start Date", "Stock type (central or agency)"],
    [5012345678900, 529, "ABC-123", 300, 499.99, null, 459.99, 46289, "AGENCY"],
    [null, null, "XYZ9", 180.5, null, null, null, null, "CENTRAL"],
  ])),
});
const listToday = parsePriceList("list.xlsx", book, 46289), listYesterday = parsePriceList("list.xlsx", book, 46288);
ok(listYesterday[0].model === "ABC-123" && listYesterday[0].price === 499.99, "price list: the B2C Agency Price column, found by its header on the Full Data tab");
ok(listToday[0].price === 459.99, "price list: a future B2C price takes over on its start date");
ok(listToday[0].ean === "5012345678900" && listToday[0].stockType === "AGENCY" && listToday[0].b2b === 300, "price list: EAN, stock type and trade price read");
ok(listToday[1].model === "XYZ9" && listToday[1].price === null && listToday[1].b2b === 180.5, "price list: a central line with no B2C price stays unpriced");
const csv = parsePriceList("list.csv", enc(`﻿"Model Number","Customer Price"\r\n"AB 12-3","£1,299.00"\r\nQ9,249\r\n`));
ok(csv.length === 2 && csv[0].model === "AB 12-3" && csv[0].price === 1299 && csv[1].price === 249, "price list: a CSV with quoted £1,299.00 prices");
let threw = false; try { parsePriceList("list.csv", enc("Name,Colour\nFridge,White\n")); } catch { threw = true; }
ok(threw, "price list: a file without model and price columns is refused, not guessed at");
// ---- WhatsApp reply (Sales & Leads)
ok(waChatHref("07906 592250", "Hi there") === "https://wa.me/447906592250?text=Hi%20there", "WhatsApp: a UK mobile becomes 447…, message typed in");
ok(waChatHref("+44 7906 592250", "x").startsWith("https://wa.me/447906592250?") && waChatHref("0044 7906 592250", "x").startsWith("https://wa.me/447906592250?"), "WhatsApp: +44 and 0044 forms too");

// ---- Search Console property: whichever of the shop's the connected account can see
process.env.NEXT_PUBLIC_SITE_URL = "https://www.kitchen-appliances.co.uk";
const realFetch = globalThis.fetch;
const sitesAre = (entries: [string, string][]) => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ siteEntry: entries.map(([siteUrl, permissionLevel]) => ({ siteUrl, permissionLevel })) }))) as any;
};
const gscDb = { googleConnection: { findUnique: async () => ({ email: "shop@example.com" }) } };
sitesAre([["https://www.kitchen-appliances.co.uk/", "siteOwner"], ["sc-domain:other-shop.co.uk", "siteOwner"]]);
ok((await searchConsoleSite(gscDb, "t1")) === "https://www.kitchen-appliances.co.uk/", "Search Console: the https://www property when that's all the account sees");
sitesAre([["https://www.kitchen-appliances.co.uk/", "siteFullUser"], ["sc-domain:kitchen-appliances.co.uk", "siteRestrictedUser"]]);
ok((await searchConsoleSite(gscDb, "t2")) === "sc-domain:kitchen-appliances.co.uk", "Search Console: the Domain property first when it can see both");
sitesAre([["sc-domain:kitchen-appliances.co.uk", "siteUnverifiedUser"], ["sc-domain:other-shop.co.uk", "siteOwner"]]);
const denied = await searchConsoleSite(gscDb, "t3").then(() => null, (e) => e);
ok(denied instanceof NoSearchConsoleAccess && denied.who === "shop@example.com" && /can't see kitchen-appliances\.co\.uk/.test(denied.message) && /other-shop/.test(denied.message),
  "Search Console: an unverified or unrelated property is refused, naming the account and what it can see");
ok((await searchConsoleSite(gscDb, null)) === null, "Search Console: not connected is null, not an error");
// ---- IndexNow (Bing): what Bing checks against the key file in public/
let sent: any = null;
globalThis.fetch = (async (_u: any, init: any) => { sent = JSON.parse(init.body); return new Response("", { status: 200 }); }) as any;
const nSent = await indexNow(Array.from({ length: 10_050 }, (_, i) => `https://www.kitchen-appliances.co.uk/products/p${i}`));
ok(nSent === 10_000 && sent.urlList.length === 10_000 && sent.host === "www.kitchen-appliances.co.uk" && sent.keyLocation === `https://www.kitchen-appliances.co.uk/${INDEXNOW_KEY}.txt`,
  "IndexNow: www host, key file on the same host, at most 10,000 pages a call");
ok(readFileSync(`public/${INDEXNOW_KEY}.txt`, "utf8").trim() === INDEXNOW_KEY, "IndexNow: the key file in public/ holds the key");
globalThis.fetch = realFetch;

console.log(`\n${n} unit assertions passed`);
