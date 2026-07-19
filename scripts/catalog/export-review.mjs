/** Slim, reviewable view of every classification decision (for audit). */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { TREE } from "./taxonomy.mjs";

const DATA = join(process.cwd(), "data");
const OUT = join(process.cwd(), "scripts", "catalog", "review");
mkdirSync(OUT, { recursive: true });
const products = JSON.parse(readFileSync(join(DATA, "products.json"), "utf8"));

const taxonomy = TREE.map((t) => `${t.id} (${t.name})\n` + t.children.map((c) => `    - ${c.id}  = ${c.name}`).join("\n")).join("\n");
writeFileSync(join(OUT, "TAXONOMY.txt"), taxonomy);

const line = (p) =>
  [p.id, p.brand, p.productCode, p.meta.leaf, (p.priceNow ?? "no-price"), JSON.stringify(p.title.slice(0, 150)), JSON.stringify(p.descriptionText.slice(0, 190))].join(" | ");

for (const src of ["ruislip", "bosch", "neff"]) {
  const rows = products.filter((p) => p.meta.source === src);
  const chunks = src === "ruislip" ? 8 : 6;
  const size = Math.ceil(rows.length / chunks);
  for (let i = 0; i < chunks; i++) {
    const slice = rows.slice(i * size, (i + 1) * size);
    if (!slice.length) continue;
    writeFileSync(
      join(OUT, `${src}-${i + 1}.txt`),
      `# slug | brand | code | assigned_leaf | price | title | description\n` + slice.map(line).join("\n")
    );
  }
  console.log(`${src}: ${rows.length} rows -> ${Math.ceil(rows.length / size)} files`);
}
console.log("review files ->", OUT);
