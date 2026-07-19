import assert from "node:assert";
import { productDoc, businessDocs } from "../../lib/rag/documents.js";
import * as seed from "../../lib/data.js";

// A product edit (price) must be reflected when its RAG doc is rebuilt.
const p: any = { ...seed.products[0] };
const before = productDoc(p);
assert.ok(before.content.includes(`£${p.priceNow}`), "original price in doc");
p.priceNow = 199; p.shortDescription = "Now reduced — clearance model.";
const after = productDoc(p);
assert.ok(after.content.includes("£199"), "edited price appears in rebuilt doc");
assert.ok(!after.content.includes(`£${before.metadata.priceNow}`) || before.metadata.priceNow === 199, "old price gone");
assert.ok(after.content.includes("clearance"), "edited description reflected");

// A business edit (phone) must be reflected in the rebuilt business docs.
const b: any = JSON.parse(JSON.stringify(seed.business)); b.phone = "0111 222 3333";
const bdocs = businessDocs(b);
assert.ok(bdocs.some((d) => d.content.includes("0111 222 3333")), "edited phone reflected in business docs");

console.log("REINDEX OK: product price/description and business phone edits are reflected on rebuild");
