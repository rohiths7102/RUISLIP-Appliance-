import assert from "node:assert";
import { findForChat, checkReply, type Found } from "../../lib/chat/finder.js";
import type { ChatMsg } from "../../lib/chat/groq.js";

// The chatbot's finder against the real (local) catalogue: what a customer
// types, and what must come back. `npm run rag:test`.
const u = (content: string): ChatMsg => ({ role: "user", content });
const a = (content: string): ChatMsg => ({ role: "assistant", content });
const cases: { q: string; before?: ChatMsg[]; expect: (f: Found) => boolean; note: string }[] = [
  { q: "Do you have the Bosch WGG254Z0GB?", expect: (f) => f.codes[0]?.status === "near" && f.codes[0].codes.includes("WGG254Z1GB") && !!f.products[0]?.code.startsWith("WGG254"), note: "an unlisted code: said so, nearest listed codes offered" },
  { q: "WGG254Z1GB price", expect: (f) => f.codes[0]?.status === "exact" && f.products[0]?.code === "WGG254Z1GB" && f.products[0].price != null, note: "an exact code comes first, with its live price" },
  { q: "whats the price of WGG254", expect: (f) => f.codes[0]?.status === "partial" && ["WGG254F1GB", "WGG254Z1GB"].every((c) => f.products.some((p) => p.code === c)), note: "part of a code finds the full codes" },
  { q: "have you got the EY 48SB8-80?", expect: (f) => f.products[0]?.code === "EY 48SB8-80", note: "a code typed with its space and dash" },
  { q: "washing machines under £400", expect: (f) => f.understood.category === "Washing Machines" && f.understood.maxPrice === 400 && f.products.length > 0 && f.products.slice(0, 3).every((p) => p.price != null && p.price <= 400), note: "department + budget, from the product table" },
  { q: "bosh dishwasher", expect: (f) => f.understood.brand === "Bosch" && /dishwasher/i.test(f.understood.category || "") && f.products.slice(0, 3).every((p) => p.brand === "Bosch"), note: "a misspelt brand" },
  { q: "samsng american fridge freezer", expect: (f) => f.understood.brand === "Samsung" && f.understood.category === "American Style Fridge Freezers", note: "a one-slip brand typo" },
  { q: "do you have hoovers under 200", expect: (f) => f.understood.brand === null && /vacuum/i.test(f.understood.category || ""), note: "\"hoover\" means a vacuum cleaner" },
  { q: "what time do you open on saturday", expect: (f) => f.knowledge.some((k) => /hours/i.test(k.title)), note: "opening hours" },
  { q: "do you deliver to Watford", expect: (f) => f.knowledge.some((k) => /deliver/i.test(k.title)), note: "delivery" },
  { q: "dishwaser", expect: (f) => f.products.slice(0, 3).some((p) => /dishwasher/i.test(`${p.department} ${p.name}`)), note: "a typo in the product word" },
  { q: "how much is the first one?", before: [u("samsung american fridge freezers"), a("Samsung American Fridge Freezer — RS67A8810B1EU — £1,099.00")],
    expect: (f) => f.products.some((p) => p.code === "RS67A8810B1EU"), note: "a follow-up keeps the product named last turn" },
  { q: "any Bosch ones?", before: [u("washing machines under 400"), a("Hisense 7kg — WF1Q7021BW — £239.99")],
    expect: (f) => f.understood.brand === "Bosch" && f.understood.category === "Washing Machines" && f.understood.carriedOver, note: "a follow-up carries the department over" },
];

let pass = 0;
for (const c of cases) {
  const t = Date.now();
  const f = await findForChat([...(c.before || []), u(c.q)], c.q);
  const ok = c.expect(f);
  const shown = f.products.slice(0, 3).map((p) => `${p.code}${p.price != null ? ` £${p.price}` : ""}`).join(", ") || f.knowledge.map((k) => k.title).join(", ") || "nothing";
  console.log(`${ok ? "✓" : "✗"} ${String(Date.now() - t).padStart(5)}ms  "${c.q}" -> ${shown}${f.codes.length ? `  [codes: ${f.codes.map((x) => `${x.asked}=${x.status}`).join(", ")}]` : ""}`);
  assert.ok(ok, c.note); pass++;
}

// The reply check: the facts pass; a price or a code that isn't in them is caught.
const f = await findForChat([u("WGG254Z1GB price")], "WGG254Z1GB price");
const p = f.products[0];
assert.deepStrictEqual(await checkReply(`${p.name} — ${p.code} — £${p.price!.toFixed(2)}`, f, "WGG254Z1GB price"), [], "a reply quoting the facts passes");
assert.ok((await checkReply(`${p.code} is £1.00 today`, f, "WGG254Z1GB price")).some((x) => x.includes("£1.00")), "a price not in the facts is caught");
assert.ok((await checkReply("Or try the RS67A8810B1EU", f, "WGG254Z1GB price")).some((x) => x.includes("RS67A8810B1EU")), "a code not in the facts is caught");
console.log(`\n${pass} finder cases + 3 reply checks passed`);
