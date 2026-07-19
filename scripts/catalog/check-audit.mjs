/** Compare the rebuilt catalogue against the audit's confirmed errors. */
import { readFileSync } from "node:fs";
const p = JSON.parse(readFileSync("data/products.json", "utf8"));
const conf = JSON.parse(readFileSync("scripts/catalog/confirmed-errors.json", "utf8"));
const bySlug = new Map(p.map((x) => [x.id, x]));

let fixed = 0, still = 0, gone = 0;
const remaining = [];
for (const c of conf) {
  const x = bySlug.get(c.slug);
  if (!x) { gone++; continue; }
  if (x.meta.leaf === c.correctLeaf) fixed++;
  else { still++; remaining.push(`${c.slug}: is "${x.meta.leaf}", audit said "${c.correctLeaf}" — ${x.title.slice(0, 55)}`); }
}
console.log(`confirmed audit errors : ${conf.length}`);
console.log(`  now at audited leaf  : ${fixed}`);
console.log(`  still differing      : ${still}`);
console.log(`  slug merged away     : ${gone}`);
if (remaining.length) {
  console.log("\nstill differing:");
  for (const r of remaining) console.log("  " + r);
}
