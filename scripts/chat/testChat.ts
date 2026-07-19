import assert from "node:assert";
import { buildSystemPrompt, buildContextBlock, extractSources } from "../../lib/chat/prompt.js";
import { searchIndex } from "../../lib/rag/index.js";
import * as seed from "../../lib/data.js";

const sys = buildSystemPrompt(seed.business);
assert.ok(sys.includes(seed.business.phone), "system prompt includes store phone");
assert.ok(/PHONE-FIRST/i.test(sys), "phone-first rule present");
assert.ok(/confirm live availability/i.test(sys), "availability rule present");
assert.ok(/never invent/i.test(sys), "no-fabrication rule present");

const hits = await searchIndex("bosch dishwasher", 6);
const ctx = buildContextBlock(hits);
assert.ok(/bosch/i.test(ctx) && /dish/i.test(ctx), "context grounds on Bosch dishwasher");
const src = extractSources(hits);
assert.ok(src.length > 0 && src.some((s) => s.url.startsWith("/products/")), "sources include product links");
assert.ok(src.some((s) => s.productCode), "a source carries a product code");
console.log("CHAT OK: grounded system prompt + retrieved context + sources");
console.log("sample sources:", src.slice(0, 3).map((s) => s.productCode || s.title).join(", "));
