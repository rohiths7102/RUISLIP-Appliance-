import assert from "node:assert";
import { gbp, availabilityLabel, telHref } from "../lib/format.js";
import { slugOf } from "../lib/select.js";
import { productDoc, buildDocuments, faqDocs } from "../lib/rag/documents.js";
import { retrieve } from "../lib/rag/retriever.js";
import { buildSystemPrompt, extractSources } from "../lib/chat/prompt.js";
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
// rag documents
const pd = productDoc(seed.products[0]);
ok(pd.content.includes(seed.products[0].productCode), "productDoc includes product code");
ok(/£/.test(pd.content), "productDoc includes price");
const docs = buildDocuments(seed as any);
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
ok(extractSources(retrieve("bosch dishwasher", rdocs, 6)).some((s) => s.url.startsWith("/products/")), "sources carry product links");

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
