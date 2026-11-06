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
import { classify, euronicsDepartment } from "../scripts/catalog/taxonomy.mjs";
import { oldAddressTarget } from "../lib/old-urls.js";
import { isBestSeller } from "../lib/best-sellers.js";
import { autoApplySource } from "../lib/price-watch/auto-apply.js";
import { readMakerPrice } from "../lib/maker-price.js";
import { syncPricewire, parseListSite, readPagePrice, pageUrlFor, checkSite, checkPassed, brandsForSite } from "../lib/price-watch/pricewire.js";
import { ruislipType } from "../scripts/catalog/ruislip-types.js";
import { toHomepage, liveOffers, DEFAULT_OFFERS, HomepageError } from "../lib/homepage.js";
import { pickPage } from "../lib/offer-ai.js";
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
{
  const poa = new Set(["Accessories & Spare Parts", "Siemens"]);
  ok(isPoaProduct(poa, { category: "Accessories & Spare Parts", subcategory: "Hob Accessories", brand: "Smeg" })
    && !isPoaProduct(poa, { category: "Accessories & Spare Parts", subcategory: "Hob Accessories", brand: "Bosch", pricewire: true })
    && isPoaProduct(poa, { category: "Accessories & Spare Parts", subcategory: "Hob Accessories", brand: "Bosch" })
    && isPoaProduct(poa, { category: "Cooking", subcategory: "Hobs", brand: "Siemens", pricewire: true }),
    "call for price: a Pricewire price shows in a call-for-price category; other accessories stay hidden; a call-for-price brand still hides");
}
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

// ---- catalogue classifier: where a new Euronics import is filed
const leafOf = (title: string) => classify({ name: title, description: title, source: "euronics", key: "t" }).leaf;
ok(leafOf("Sharp YC-MA262AE-B Classic Microwave Oven, 26L, Combi with Air Fryer - Black") === "microwaves"
  && leafOf("Russell Hobbs RHMAF2508B 25 Litres Combination Air Fryer Microwave - Black") === "microwaves",
  "classifier: a combination microwave with an air fryer is a microwave");
ok(leafOf("Ninja AF160UK Air Fryer Max - Grey") === "air-fryers-multi-cookers", "classifier: a plain air fryer is still an air fryer");
ok(euronicsDepartment("https://www.euronics.co.uk/catalogue/cooking/hobs/gas-hobs/hoover-hvg6k3b-60cm-gas-hob-black/p/HVRHVG6K3B") === "Cooking"
  && euronicsDepartment("https://www.euronics.co.uk/catalogue/refrigeration/larder-fridges/x/p/LBHURPD365I") === "Refrigeration",
  "Euronics department: read from the page URL");
ok(euronicsDepartment("https://www.euronics.co.uk/catalogue/cooking/cookware-and-bakeware/x/p/NINC10024UK") === ""
  && euronicsDepartment("https://www.euronics.co.uk/p/HOTSA2540HWH") === ""
  && euronicsDepartment("https://www.euronics.co.uk/catalogue/small-appliances/air-fryers/x/p/NINAF160UK") === "",
  "Euronics department: no verdict for cookware, a bare /p/ link or small appliances");

// ---- old-site addresses Google still sends people to
const oldCat = {
  products: [{ productCode: "KGN392LDFG", brand: "Bosch", newSlug: "/products/bosch-kgn392ldfg" }, { productCode: "Z5102X1", brand: "Neff", newSlug: "/products/neff-z5102x1" }],
  categories: ["washing-machines", "cooker-hoods", "vacuum-cleaners", "dishwashers", "integrated-dishwashers", "tv-audio"].map((id) => ({ id })),
  brands: [{ slug: "indesit" }],
};
ok(oldAddressTarget("/bosch-kgn392ldfg-60cm-7030-fridge-freezer---inox/p-7261", oldCat) === "/products/bosch-kgn392ldfg", "old address: the model code in it finds the product");
ok(oldAddressTarget("/indesit-7kg-1200-spin-washing-machine---white---a-energy-rated/p-4710", oldCat) === "/categories/washing-machines", "old address: no code, so the product type's department");
ok(oldAddressTarget("/cooking/cooker-hoods", oldCat) === "/categories/cooker-hoods" && oldAddressTarget("/dishwashing", oldCat) === "/categories/dishwashers",
  "old address: old department pages, plurals and renamed departments included");
ok(oldAddressTarget("/indesit-something-unnamed/p-99999", oldCat) === "/brands/indesit", "old address: only a brand left, so the brand page");
ok(oldAddressTarget("/zenith-integrated-dishwasher---a-energy-rated/p-4561", oldCat) === "/categories/integrated-dishwashers",
  "old address: a known mapping to a product no longer on the site falls through instead of sending anyone to a 404");
ok(oldAddressTarget("/wp-login.php", oldCat) === null && oldAddressTarget("/random-page", oldCat) === null && oldAddressTarget("/_shops/c/currys_28.htm", oldCat) === null,
  "old address: anything that names nothing stays a 404");

// ---- Pricewire prices reach the products that follow that site only
ok(isBestSeller("KIN96NSE0G") && isBestSeller("kin96nse0g") && !isBestSeller("KIN96NSEOG") && !isBestSeller("KGN39VLEBG"),
  "best sellers: listed codes only, case-insensitive, typos not accepted");
{
  const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000);
  // Reads newest first, as the query orders them.
  const read = (productId: string, price: number | null, d = 0) => ({ id: `o-${productId}-${d}`, productId, sourceId: "manufacturer-rrp", price, deliveryCost: null, inStock: price !== null, includesVat: true, sourceUrl: "https://www.bosch-home.co.uk/x", matchConfidence: 1, status: price === null ? "no_offer" : "ok", observedAt: daysAgo(d) });
  const product = (id: string, productCode: string, priceNow: number | null) => ({ id, productCode, title: productCode, brand: "Bosch", category: "Laundry", subcategory: "Washing Machines", priceNow, priceWas: null, saving: null, costPrice: null, floorPrice: null, agencyStock: false, adminOverrideFields: ["priceNow"] });
  const run = async (products: any[], reads: any[], opts: { follows?: string[]; approvedBy?: string; allowAutoApply?: boolean } = {}) => {
    const writes: { id: string; data: any }[] = [];
    const follows = opts.follows ?? products.map((p) => p.id);
    const fake: any = {
      priceSource: { findUnique: async () => ({ id: "manufacturer-rrp", label: "Manufacturer RRP", kind: "authorised", enabled: true, allowAutoApply: opts.allowAutoApply ?? true, priceIncludesVat: true }), update: async () => ({}) },
      priceSite: { findMany: async () => [] },
      brandPriceItem: { findMany: async ({ where }: any) => (where.siteId === "manufacturer-rrp" ? follows.map((productId) => ({ productId })) : []) },
      priceObservation: { findMany: async ({ where }: any) => (where.sourceId === "cih" ? [] : reads) },
      product: { findMany: async () => products, update: async ({ where, data }: any) => { writes.push({ id: where.id, data }); return {}; } },
      category: { findMany: async () => [] }, brand: { findMany: async () => [] },
      adminAuditLog: { create: async () => ({}) },
    };
    return { outcome: await autoApplySource(fake, { sourceId: "manufacturer-rrp", approvedBy: opts.approvedBy }), writes };
  };
  const a = await run([product("best", "WAN28259GB", 479), product("other", "WGG254Z1XX", null)], [read("best", 499), read("other", 649)], { follows: ["best"] });
  ok(a.outcome.considered === 1 && a.writes.length === 1 && a.writes[0].id === "best" && a.writes[0].data.priceNow === 499,
    "maker price: a product following the maker takes its price with no cost on file; one following Ruislip Appliances is never touched by a maker read");
  const b = await run([product("best", "WAN28259GB", 479)], [read("best", null), read("best", null, 1)]);
  ok(!b.writes.length && b.outcome.refused.maker_not_selling === 1,
    "maker price: the maker's shop not selling a best seller keeps Sachin's price and holds the row");
  const c = await run([product("best", "KIN96NSE0G", null)], [read("best", 899), read("best", 889, 1)]);
  const d = await run([product("best", "KIN96NSE0G", null)], [read("best", 899)]);
  ok(c.writes.length === 1 && c.writes[0].data.priceNow === 899 && !d.writes.length && d.outcome.refused.no_current_price === 1,
    "maker price: a best seller with no price gets one after two maker reads agree, never from a single read");
  const e = await run([product("x", "KIN96NSE0G", null)], [read("x", 899)], { approvedBy: "sachin@example.com", allowAutoApply: false });
  ok(e.writes.length === 1 && e.writes[0].data.priceNow === 899, "brand prices: a person's Apply gives a first price from one read, even with the source on manual");
  const many = Array.from({ length: 130 }, (_, i) => product(`p${i}`, `C${i}`, 100));
  const f = await run(many, many.map((p) => read(p.id, 110)));
  const g = await run(many, many.map((p) => read(p.id, 110)), { approvedBy: "sachin@example.com" });
  ok(f.outcome.halted && !f.writes.length && g.writes.length === 130, "brand prices: unattended, 130 changes out of 130 trip the budget; a person's Apply has none");
}

// ---- the makers' own pages: the three shapes Bosch and Neff print (30 Sept 2026)
{
  const ld = (offers: unknown, mpn = "KIN96NSE0G") => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org/", "@type": "Product", name: "Series 6 Built-in fridge-freezer", mpn, offers })}</script>`;
  const retailers = { "@type": "AggregateOffer", offerCount: 2, offers: [{ "@type": "Offer", seller: { name: "Currys" }, price: 749 }, { "@type": "Offer", seller: { name: "AO" } }] };
  const bsh = (price: number) => ({ "@type": "Offer", seller: { "@type": "Organization", name: "BSH" }, price, priceCurrency: "GBP", availability: "https://schema.org/InStock" });
  const main = (p: string) => `<style data-emotion="css t6">.css-t6{font-weight:bold}</style><div data-testid="price-main-price" class="css-t6">£${p} </div><div data-testid="product-price-info">VAT included</div>`;
  const sale = (now: string, was: string) => `<div data-testid="price-reduced-price" class="c"><style>.x{}</style><div style="width:max-content">£${now}</div><div data-testid="price-standard-discount-section"><span>Old price £${was}</span><div data-testid="price-strikethrough-price">£${was}</div></div></div>`;
  const inShop = readMakerPrice(ld([bsh(449), retailers]) + main("449.00") + main("449.00"), "KIN96NSE0G");
  ok(inShop.price === 449 && inShop.price !== null && inShop.inStock && inShop.from === "offer", "maker page: on sale in their shop, the BSH offer is the price");
  const unavailable = readMakerPrice(ld(retailers) + main("899.00") + main("899.00"), "KIN96NSE0G");
  ok(unavailable.price === 899 && unavailable.price !== null && !unavailable.inStock && unavailable.from === "screen",
    "maker page: 'currently unavailable' has no BSH offer, so the on-screen price is read — never a retailer's (Currys' £749)");
  ok(readMakerPrice(ld(retailers) + sale("399.00", "449.00") + sale("399.00", "449.00"), "KIN96NSE0G").price === 399, "maker page: on promotion the reduced price is read, never the struck-through 'Old price'");
  const gone = readMakerPrice(ld(retailers) + "<p>Product is no longer available</p>", "KIN96NSE0G");
  ok(gone.price === null && gone.reason === "discontinued", "maker page: a dropped model gives no price (and says why)");
  const clash = readMakerPrice(ld([bsh(449)]) + main("499.00"), "KIN96NSE0G");
  const twoBoxes = readMakerPrice(ld(retailers) + main("899.00") + main("949.00"), "KIN96NSE0G");
  ok(clash.price === null && clash.reason === "prices_disagree" && twoBoxes.price === null, "maker page: two different prices on one page means the page is not understood, and nothing is read");
  const other = readMakerPrice(ld([bsh(529)], "S153HKX06G") + main("529.00"), "S153HKX03G");
  ok(other.price === null && other.reason === "other_model", "maker page: a page about another model (e.g. a successor) is never read as this one");

}

// ---- Pricewire: price lists, product pages, the owner's sites (Oct 2026)
{
  const list = [
    "# Ruislip Appliances - full product list", "## Washing Machines",
    "- [Bosch WGG254Z1GB 10kg Washing Machine](https://www.ruislipappliances.com/products/WGG254Z1GB.md): £499.00, In stock",
    "- [SIEMENSIQ500 80cm Venting Hob ED851HQ26E](https://www.ruislipappliances.com/products/ED851HQ26E.md): £1,999.00, Special order",
    "- [Neff N70 Hob T99NEW1](https://www.ruislipappliances.com/products/T99NEW1.md): £649.00, Special order",
    "- [SMEG Warming Drawer CPR315X](https://www.ruislipappliances.com/products/CPR315X.md): £529.00, Special order",
    "## Graded stock (discounted)",
    "- [Bosch WAN28259GB](https://www.ruislipappliances.com/products/WAN28259GB.htm?GrID=1): graded £49.00 (new £479.00), Grade 1",
  ].join("\n");
  const parsed = parseListSite(list);
  ok(parsed.get("WGG254Z1GB")?.price === 499 && parsed.get("WGG254Z1GB")?.inStock === true && parsed.get("ED851HQ26E")?.price === 1999
    && parsed.get("ED851HQ26E")?.brand === "Siemens" && parsed.get("CPR315X")?.brand === null && !parsed.has("WAN28259GB")
    && parsed.get("WGG254Z1GB")?.url === "https://www.ruislipappliances.com/products/WGG254Z1GB.htm",
    "price list: price, stock and brand per model; ex-display graded units are never a model's price");

  const bsh = (mpn: string, price = 899) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", mpn, offers: { "@type": "Offer", seller: { name: "BSH" }, price, availability: "InStock" } })}</script>`;
  const shop = (sku: string, price: number) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: `Bosch ${sku} washer`, sku, offers: { "@type": "Offer", price: String(price), priceCurrency: "GBP", availability: "https://schema.org/InStock" } })}</script>`;
  ok(readPagePrice(shop("WGG254Z1GB", 499).replace('type="application/ld+json"', "type=application/ld+json"), "WGG254Z1GB", "https://www.ruislipappliances.com/products/WGG254Z1GB.htm").price === 499,
    "product page: an unquoted type=application/ld+json tag (ruislipappliances.com) is read too");
  ok(readPagePrice(bsh("WGG254Z1GB"), "WGG254Z1GB", "https://www.bosch-home.co.uk/en/product/WGG254Z1GB").price === 899
    && readPagePrice(shop("WGG254Z1GB", 479), "WGG254Z1GB", "https://www.markselectrical.co.uk/x").price === 479
    && readPagePrice(shop("WGG254Z1GB", 479), "WGG254Z1GB", "https://www.markselectrical.co.uk/x").inStock === true
    && readPagePrice(shop("WGG254ZXGB", 479), "WGG254Z1GB", "https://www.markselectrical.co.uk/x").price === null
    && readPagePrice("<p>hello</p>", "WGG254Z1GB", "https://www.markselectrical.co.uk/x").price === null,
    "product page: a maker page goes through the maker reader; any other site must name the model in its product data, else nothing is read");
  ok(pageUrlFor("https://www.bosch-home.co.uk/en/product/{code}", "WGG254Z1GB") === "https://www.bosch-home.co.uk/en/product/WGG254Z1GB"
    && pageUrlFor("https://www.bosch-home.co.uk/en/product/{code}", "X", "https://www.bosch-home.co.uk/en/product/a/b/X") === "https://www.bosch-home.co.uk/en/product/a/b/X"
    && pageUrlFor("https://www.bosch-home.co.uk/en/product/{code}", "X", "https://www.ruislipappliances.com/products/X.htm") === "https://www.bosch-home.co.uk/en/product/X",
    "product page address: the product's own page when it is on that site, else the site's address with the model number");

  const make = (feeds: any[], opts: { listOk?: boolean; sites?: any[] } = {}) => {
    const items = new Map<string, any>(); const obs: any[] = [];
    const siteRows = new Map<string, any>([
      { id: "ruislip-appliances", name: "Ruislip Appliances", kind: "list", url: "https://list", enabled: true },
      { id: "bosch-home", name: "Bosch", kind: "page", url: "https://www.bosch-home.co.uk/en/product/{code}", enabled: true },
      { id: "neff-home", name: "Neff", kind: "page", url: "https://www.neff-home.com/uk/en/product/{code}", enabled: true },
      { id: "siemens-home", name: "Siemens", kind: "page", url: "https://www.siemens-home.bsh-group.com/uk/en/mkt-product/{code}", enabled: true },
      ...(opts.sites || []),
    ].map((s) => [s.id, { lastReadSummary: "", notInCatalogue: "[]", ...s }]));
    const feedRows = new Map<string, any>(feeds.map((f) => [f.brand, { fallbackSiteId: "", enabled: true, ...f }]));
    const products = [
      { id: "listed", brand: "Bosch", productCode: "WGG254Z1GB", sourceUrl: "https://www.bosch-home.co.uk/en/product/x/WGG254Z1GB" },
      { id: "unlisted", brand: "BOSCH", productCode: "KIN96NSE0G", sourceUrl: "https://www.ruislipappliances.com/products/KIN96NSE0G.htm" },
      { id: "sie", brand: "Siemens", productCode: "ED851HQ26E", sourceUrl: "" },
    ];
    const fetched: string[] = [];
    const db: any = {
      priceSource: { upsert: async () => ({}) },
      priceSite: { upsert: async () => ({}), findMany: async () => [...siteRows.values()], update: async ({ where, data }: any) => Object.assign(siteRows.get(where.id), data) },
      brandPriceFeed: { upsert: async () => ({}), findMany: async () => [...feedRows.values()], update: async ({ where, data }: any) => Object.assign(feedRows.get(where.brand), data) },
      product: { findMany: async ({ where }: any) => products.filter((p) => where.brand.in.includes(p.brand)) },
      brandPriceItem: {
        findMany: async () => [...items.values()],
        createMany: async ({ data }: any) => data.forEach((d: any) => items.set(d.productId, { siteId: "", readAt: null, ...d })),
        update: async ({ where, data }: any) => Object.assign(items.get(where.productId), data),
        updateMany: async ({ where, data }: any) => [...items.values()].filter((i) => where.brand.in.includes(i.brand)).forEach((i) => Object.assign(i, data)),
      },
      priceObservation: { createMany: async ({ data }: any) => obs.push(...data) },
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    };
    const fetcher = async (url: string) => {
      fetched.push(url);
      if (url === "https://list") { if (opts.listOk === false) throw new Error("timed out"); return { html: list }; }
      if (url.startsWith("https://other/")) return { html: shop(url.split("/").pop()!, 450) };
      return { html: bsh(decodeURIComponent(url.split("/").pop()!)) };
    };
    return { db, items, obs, fetched, fetcher, feedRows, siteRows };
  };
  const RA = { siteId: "ruislip-appliances" };

  const r = make([{ brand: "Bosch", ...RA, fallbackSiteId: "bosch-home" }, { brand: "Neff", ...RA, fallbackSiteId: "neff-home" }, { brand: "Siemens", ...RA }]);
  const t = await syncPricewire(r.db, { fetcher: r.fetcher });
  const ob = (id: string, src: string) => r.obs.find((o) => o.productId === id && o.sourceId === src);
  ok(r.items.get("listed").siteId === "ruislip-appliances" && r.items.get("listed").price === 499 && ob("listed", "ruislip-appliances")?.price === 499 && !ob("listed", "bosch-home")
    && r.items.get("unlisted").siteId === "bosch-home" && r.items.get("unlisted").price === 899 && ob("unlisted", "bosch-home")?.price === 899
    && r.fetched.includes("https://www.bosch-home.co.uk/en/product/KIN96NSE0G") && r.items.get("sie").price === 1999 && r.items.get("sie").siteId === "ruislip-appliances",
    "Pricewire: a listed model follows the list site; one it doesn't list is read from the backup site at its address");
  ok(t.brands.Bosch.priced === 2 && t.brands.Bosch.bySite["ruislip-appliances"] === 1 && t.brands.Bosch.bySite["bosch-home"] === 1 && t.sites["ruislip-appliances"].priced === 2,
    "Pricewire: the run says how many each brand got from each site");
  const missing = JSON.parse(r.siteRows.get("ruislip-appliances").notInCatalogue);
  ok(missing.length === 1 && missing[0].code === "T99NEW1" && missing[0].brand === "Neff",
    "Pricewire: models in a list that we don't have are kept per site, our brands only");

  const m = make([{ brand: "Bosch", siteId: "bosch-home" }]);
  await syncPricewire(m.db, { fetcher: m.fetcher });
  ok(m.items.get("listed").siteId === "bosch-home" && m.items.get("listed").price === 899 && m.fetched.includes("https://www.bosch-home.co.uk/en/product/x/WGG254Z1GB")
    && !m.fetched.includes("https://list") && !m.items.has("sie"),
    "Pricewire: a brand on a page site reads every model's page (its own page first), never a list it doesn't use; other brands untouched");

  const own = make([{ brand: "Bosch", siteId: "other-shop" }], { sites: [{ id: "other-shop", name: "Other shop", kind: "page", url: "https://other/{code}", enabled: true }] });
  await syncPricewire(own.db, { fetcher: own.fetcher });
  ok(own.items.get("listed").siteId === "other-shop" && own.items.get("listed").price === 450 && own.obs.some((o) => o.sourceId === "other-shop" && o.price === 450),
    "Pricewire: a site the owner added works like a built-in one, under its own price source");

  const down = make([{ brand: "Bosch", ...RA, fallbackSiteId: "bosch-home" }], { listOk: false });
  await syncPricewire(down.db, { fetcher: down.fetcher });
  Object.assign(down.items.get("listed"), { siteId: "ruislip-appliances", price: 499 });
  const t2 = await syncPricewire(down.db, { fetcher: down.fetcher });
  ok(t2.sites["ruislip-appliances"].error && down.items.get("listed").siteId === "ruislip-appliances" && down.items.get("listed").price === 499
    && !down.obs.some((o) => o.productId === "listed" && o.sourceId === "bosch-home"),
    "Pricewire: with a list unreadable, its products keep their mapping; nothing flips to the backup for a night");

  const late = make([{ brand: "Bosch", siteId: "bosch-home" }]);
  const t3 = await syncPricewire(late.db, { fetcher: late.fetcher, deadlineMs: -1 });
  ok(t3.brands.Bosch.left === 2 && t3.sites["bosch-home"] === undefined, "Pricewire: pages not started by the deadline are counted for the next run, not dropped");

  const off = make([{ brand: "Bosch", ...RA }]);
  await syncPricewire(off.db, { fetcher: off.fetcher });
  off.feedRows.get("Bosch").enabled = false;
  await syncPricewire(off.db, { fetcher: off.fetcher });
  ok([...off.items.values()].every((i) => i.siteId === ""), "Pricewire: a brand switched off follows no site, so nothing is applied to it");

  const blocked = make([{ brand: "Bosch", siteId: "bosch-home" }]);
  await syncPricewire(blocked.db, { fetcher: blocked.fetcher });
  const t4 = await syncPricewire(blocked.db, { fetcher: async (url: string) => { blocked.fetched.push(url); throw new Error("That website blocked us"); } });
  ok(t4.brands.Bosch.unread === 2 && blocked.items.get("listed").siteId === "bosch-home" && blocked.items.get("listed").price === 899
    && blocked.obs.filter((o) => o.productId === "listed" && o.status === "parse_failed").length === 1,
    "Pricewire: a page that could not be read (blocked, slow) keeps the product's last mapping, and the failed read is on record");

  const wall = make([{ brand: "Bosch", siteId: "bosch-home" }]);
  const manyBosch = Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, brand: "Bosch", productCode: `WAN${i}`, sourceUrl: "" }));
  wall.db.product.findMany = async () => manyBosch;
  let hits = 0;
  const t5 = await syncPricewire(wall.db, { fetcher: async () => { hits++; throw new Error("blocked"); }, concurrency: 1 });
  ok(hits === 10 && t5.brands.Bosch.unread === 10 && t5.brands.Bosch.left === 30 && /blocking/.test(t5.sites["bosch-home"].error),
    "Pricewire: a site that fails 10 pages in a row is left alone for the rest of the run; the rest wait for tomorrow");

  const siteOff = make([{ brand: "Bosch", ...RA, fallbackSiteId: "bosch-home" }]);
  siteOff.siteRows.get("bosch-home").enabled = false;
  await syncPricewire(siteOff.db, { fetcher: siteOff.fetcher });
  ok(siteOff.items.get("unlisted").siteId === "" && !siteOff.fetched.some((u) => u.includes("bosch-home")),
    "Pricewire: a site switched off is never read, even as a backup");
}

// ---- Pricewire site checks: only a site that reads a brand correctly can price it
{
  const page = (sku: string, price: number) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: sku, sku, offers: { "@type": "Offer", price } })}</script>`;
  const ours = [
    ["A1", 500], ["A2", 400], ["A3", 300], ["A4", 800], ["A5", 1000], ["A6", 250],
  ].map(([code, priceNow]) => ({ id: code, productCode: code, sourceUrl: "", priceNow, brandPriceItem: null }));
  const make = () => {
    const saved: any[] = [];
    const db: any = {
      priceSite: { findUnique: async () => ({ id: "shop", kind: "page", url: "https://shop.example/{code}" }) },
      product: { findMany: async () => ours },
      priceSiteCheck: { upsert: async ({ create }: any) => { saved.push(create); }, findUnique: async () => saved.at(-1) ? { ...saved.at(-1), checkedAt: new Date() } : null },
    };
    return { db, saved };
  };
  const good = make();
  const r1 = await checkSite(good.db, "shop", "Bosch", async (url) => { const c = url.split("/").pop()!; return { html: page(c, ours.find((o) => o.productCode === c)!.priceNow * 0.9) }; });
  ok(r1.passed && r1.lines.filter((l) => l.status === "correct").length === 5 && await checkPassed(good.db, "shop", "Bosch"),
    "site check: a site reading 5 models within 35% of our price passes and can then be picked");
  const off = make();
  const r2 = await checkSite(off.db, "shop", "Bosch", async (url) => { const c = url.split("/").pop()!; return { html: page(c, c === "A1" || c === "A2" ? 9 : ours.find((o) => o.productCode === c)!.priceNow) }; });
  ok(!r2.passed && r2.lines.some((l) => l.status === "wrong_price") && !(await checkPassed(off.db, "shop", "Bosch")),
    "site check: two prices way off (a misreading site, £9 for a £500 model) fail the check");
  const wall = make();
  let tries = 0;
  const r3 = await checkSite(wall.db, "shop", "Bosch", async () => { tries++; throw new Error("blocked"); });
  ok(!r3.passed && tries === 5 && /blocking/.test(r3.summary), "site check: a site that won't answer stops after 5 pages and fails, saying it may be blocking us");
  const other = make();
  const r4 = await checkSite(other.db, "shop", "Bosch", async () => ({ html: page("ZZ999", 450) }));
  ok(!r4.passed && r4.lines.every((l) => l.status === "wrong_model"), "site check: pages about other models never count as correct");
}

ok(brandsForSite("siemens-home").join() === "Siemens" && brandsForSite("bosch-home").join() === "Bosch" && brandsForSite("ruislip-appliances").length === 3 && brandsForSite("my-new-shop").length === 3,
  "site brands: a maker's own site is for its own brand only; a shop (Ruislip, any added site) for all three");
{
  let threw = "";
  try { await checkSite({ priceSite: { findUnique: async () => ({ id: "siemens-home", name: "Siemens", kind: "page", url: "x/{code}" }) } } as any, "siemens-home", "Bosch"); } catch (e: any) { threw = e.message; }
  ok(/only sells Siemens/.test(threw), "site check: checking Siemens' own site for Bosch is refused, not run");
}

// ---- Ruislip import: the type comes from their section, words only choose within it
ok(ruislipType("Hobs", "Hobs (Built-In)", "iQ700 80cm FlexInduction Hob - TFT TouchControl") === "hobs"
  && ruislipType("Venting Hobs", "Venting Hobs (Built-In)", "IQ500 80cm Venting Hob") === "venting-hobs"
  && ruislipType("Hoods", "Hoods", "73cm, 3 speeds + intensive, LED lights. Optional recirculation kit") === "cooker-hoods"
  && ruislipType("Hoods", "Hoods", "Clean Air Plus recirculation filter kit") === "cooker-hood-accessories"
  && ruislipType("Refrigeration", "Refrigeration (Built-In)", "N50 Integrated Fridge Freezer 177x54 70/30") === "integrated-fridge-freezers"
  && ruislipType("Dishwashers", "Dishwashers (Built-In)", "N50 45cm slimline fully integrated") === "integrated-slimline-dishwashers"
  && ruislipType("Coffee Machines", "Coffee Machines", "Tassimo Hot Drinks Machine") === "tassimo"
  && ruislipType("Other Products", "", "Something") === null,
  "Ruislip import: hobs stay hobs whatever their spec words, hoods that mention a kit stay hoods, and an unknown section is not guessed");

// ---- homepage offers (Admin → Homepage → Offers)
{
  const o = (p: object) => ({ id: "x", enabled: true, href: "/brands/liebherr", alt: "Liebherr offer", wide: "/promo/a.png", mobile: "", bg: "#003058", start: "", end: "", ...p });
  ok(toHomepage(null).offers.length === DEFAULT_OFFERS.length && toHomepage({ offers: [] }).offers.length === 0,
    "offers: never saved = the strip as it was; saved empty = no strip");
  const live = liveOffers(toHomepage({ offers: [o({ id: "a" }), o({ id: "b", end: "2026-10-11" }), o({ id: "c", start: "2026-10-13" }), o({ id: "d", enabled: false })] }).offers, "2026-10-12");
  ok(live.map((x) => x.id).join() === "a", "offers: an ended, a not-yet-started and a hidden offer stay off the homepage");
  const refused = (raw: object) => { try { toHomepage({ offers: [o(raw)] }, true); return false; } catch (e) { return e instanceof HomepageError; } };
  ok(refused({ wide: "" }) && refused({ href: "javascript:alert(1)" }) && refused({ href: "//evil.example" }) && refused({ alt: " " }) && refused({ start: "2026-11-02", end: "2026-11-01" }),
    "offers: a save without a picture, a page or a description, or with a page that isn't ours/https, or ending before it starts is refused");
  const pages = [{ href: "/products", label: "All appliances" }, { href: "/brands/schonhaus", label: "Schönhaus" }, { href: "/brands/liebherr", label: "Liebherr" }, { href: "/categories/fridge-freezers", label: "Fridge Freezers" }];
  ok(pickPage("/brands/liebherr", "", pages) === "/brands/liebherr" && pickPage("/brands/made-up", "SCHONHAUS beautifully at home", pages) === "/brands/schonhaus"
    && pickPage("", "half price fridge freezers this week", pages) === "/categories/fridge-freezers" && pickPage("", "black friday", pages) === "/products",
    "offer AI: only our own pages — an invented page falls back to a brand/department named in the banner, else the whole range");
}

// Pricewire AI: matching a document's rows to our products, and cleaning what the AI returns.
{
  const { makeMatcher, cleanRows, cleanPrice, readDocument } = await import("../lib/price-watch/pricewire-ai.js");
  const { validHistory } = await import("../lib/price-watch/pricewire-agent.js");
  const match = makeMatcher([
    { id: "a", productCode: "WGG24409GB", gtin: "4242005321234", brand: "Bosch" },
    { id: "b", productCode: "SMS2HVW67G/01", brand: "Bosch" },
    { id: "c", productCode: "N50ABC1234", brand: "Neff" }, { id: "d", productCode: "N50ABC1235", brand: "Siemens" },
  ]);
  ok(match({ model: "wgg 24409-gb", ean: "", brand: "" }).productIds.join() === "a" && match({ model: "X", ean: "4242005321234", brand: "" }).by === "ean",
    "AI import: a model code matches whatever its spacing, dashes or case; else the EAN");
  ok(match({ model: "SMS2HVW67G", ean: "", brand: "" }).by === "close" && match({ model: "N50ABC123", ean: "", brand: "" }).productIds.length === 0
    && match({ model: "N50ABC123", ean: "", brand: "Neff" }).productIds.join() === "c",
    "AI import: a short suffix difference matches only when ONE product fits (or the brand settles it)");
  ok(match({ model: "WGG2", ean: "", brand: "" }).productIds.length === 0, "AI import: a fragment of a code never matches");
  const rows = cleanRows([{ model: " WGG24409GB ", ean: "4242-0053-21234", brand: "Bosch", description: "Washer", price: 499, wasPrice: 449, priceType: "retail" },
    { model: "WGG24409GB", price: 499 }, { model: "A", price: 10 }, { model: "KGN39VWEAG", price: -5, priceType: "nonsense" }]);
  ok(rows.length === 2 && rows[0].model === "WGG24409GB" && rows[0].ean === "4242005321234" && rows[0].wasPrice === null && rows[1].price === null && rows[1].priceType === "unknown",
    "AI import: rows are trimmed, de-duplicated, a was-price below the price and a negative price are dropped, unknown types stay unknown");
  ok(cleanPrice("£1,299.99") === 1299.99 && cleanPrice(0) === null && cleanPrice(250000) === null, "AI import: prices are cleaned and implausible ones refused");
  const prevKey = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  const cih = await readDocument("list.csv", new TextEncoder().encode("Model Number,B2C Agency Price\nWGG24409GB,499\n"));
  ok(cih.via === "table" && cih.rows[0].price === 499, "AI import: the Euronics price list is read directly, without the AI");
  let aiNeeded = ""; try { await readDocument("flyer.pdf", new Uint8Array([37, 80, 68, 70])); } catch (e) { aiNeeded = (e as Error).message; }
  ok(/ANTHROPIC_API_KEY/.test(aiNeeded), "AI import: without a key, a document that needs the AI says how to switch it on");
  if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
  ok(validHistory([]) && validHistory([{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "hello" }] }])
    && !validHistory([{ role: "assistant", content: "x" }]) && !validHistory([{ role: "system", content: "x" }]) && !validHistory("x"),
    "assistant: only a conversation that starts with the user and has user/assistant turns is accepted back");
}

console.log(`\n${n} unit assertions passed`);
