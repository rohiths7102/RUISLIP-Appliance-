import assert from "node:assert";
import { buildSystemPrompt, factsBlock, sourcesFor } from "../../lib/chat/prompt.js";
import { findForChat } from "../../lib/chat/finder.js";
import * as seed from "../../lib/data.js";

const sys = buildSystemPrompt(seed.business);
assert.ok(sys.includes(seed.business.phone), "system prompt includes store phone");
assert.ok(/PHONE-FIRST/i.test(sys), "phone-first rule present");
assert.ok(/confirm live availability/i.test(sys), "availability rule present");
assert.ok(/never invent/i.test(sys), "no-fabrication rule present");
assert.ok(/exactly as written/i.test(sys), "exact code-and-price rule present");

const q = "bosch dishwasher";
const found = await findForChat([{ role: "user", content: q }], q);
const ctx = factsBlock(found);
assert.ok(/LIVE PRODUCT DATA/.test(ctx) && /bosch/i.test(ctx) && /dish/i.test(ctx), "facts ground on Bosch dishwashers, from the live catalogue");
const first = found.products[0];
const src = sourcesFor(`${first.name} — ${first.code}`, found);
assert.ok(src[0]?.url.startsWith("/products/") && src[0].productCode === first.code, "a named product becomes its link");
console.log("CHAT OK: grounded system prompt + live facts + links");
console.log("sample facts:", found.products.slice(0, 3).map((p) => `${p.code} ${p.price != null ? `£${p.price}` : "call"}`).join(", "));
