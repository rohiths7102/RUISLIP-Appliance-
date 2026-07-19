import assert from "node:assert";
import { searchIndex } from "../../lib/rag/index.js";
const cases: { q: string; expect: (h: any[]) => boolean; note: string }[] = [
  { q: "WAN28258GB", expect: (h) => h[0]?.doc.metadata?.productCode === "WAN28258GB", note: "exact product code -> that product first" },
  { q: "bosch dishwasher", expect: (h) => h.slice(0, 3).some((x) => x.doc.metadata?.brand === "Bosch" && /dish/i.test(x.doc.metadata?.category || "")), note: "brand+type surfaces Bosch dishwasher" },
  { q: "what are your opening hours", expect: (h) => h.slice(0, 3).some((x) => x.doc.sourceId === "hours"), note: "opening hours doc" },
  { q: "do you deliver appliances", expect: (h) => h.slice(0, 3).some((x) => x.doc.sourceId === "delivery"), note: "delivery doc" },
  { q: "how do I pay for an item", expect: (h) => h.slice(0, 4).some((x) => x.doc.sourceType === "faq"), note: "payment/how-to-buy FAQ" },
];
let pass = 0;
for (const c of cases) {
  const hits = await searchIndex(c.q, 6);
  const ok = c.expect(hits);
  console.log(`${ok ? "✓" : "✗"} "${c.q}" -> ${hits.slice(0, 3).map((h) => h.doc.title).join(" | ")}`);
  assert.ok(ok, c.note); pass++;
}
console.log(`\n${pass} retrieval cases passed`);
