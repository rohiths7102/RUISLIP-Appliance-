/**
 * Sync the homepage "featured products" row with the shop's own Euronics
 * storefront (kitchen-appliances.co.uk).
 *
 * That carousel is what the owner actually promotes: the current offers, in his
 * order, with the Euronics "best seller" flags and any was/save prices. We read
 * it, write data/featured-products.json, and with --apply bring the matching
 * local prices into line (skipping anything an admin has locked).
 *
 *   node scripts/catalog/sync-featured.mjs            # refresh the JSON only
 *   node scripts/catalog/sync-featured.mjs --apply    # …and apply the prices
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const SOURCE = argOf("--url", "https://www.kitchen-appliances.co.uk/");
const OUT = fileURLToPath(new URL("../../data/featured-products.json", import.meta.url));

const money = (t) => {
  const n = t && t.replace(/[^0-9.]/g, "");
  return n ? Number(n) : null;
};
// The page is served as latin-1-ish with £ signs the fetch decoder mangles; we
// only ever read the digits, so the entities that survive do not matter.
const unescapeText = (t) =>
  String(t || "")
    .replace(/&amp;amp;/g, "&").replace(/&amp;/g, "&")
    .replace(/&#0?39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();

function parseFeatured(html) {
  const start = html.indexOf('class="product-tab-carousel');
  if (start < 0) throw new Error('featured carousel not found — the storefront markup changed');
  const end = html.indexOf("</section>", start);
  const block = html.slice(start, end > 0 ? end : html.length);
  return block
    .split('<div class="item">')
    .slice(1)
    .map((it, i) => ({
      code: (it.match(/class="product-code small">([^<]*)</) || [])[1]?.trim(),
      title: unescapeText((it.match(/"name":\s*"([^"]*)"/) || [])[1]),
      price: money((it.match(/"price":\s*"([^"]*)"/) || [])[1]),
      priceWas: money((it.match(/class="product-was[^"]*">\s*Was\s*([^<]*)</) || [])[1]),
      saving: money((it.match(/class="product-save[^"]*">\s*Save\s*([^<]*)</) || [])[1]),
      bestSeller: /best-seller-primary/.test(it),
      order: i,
    }))
    .filter((x) => x.code);
}

const res = await fetch(SOURCE, { headers: { "user-agent": "JyotsnaSiteSync/1.0 (owner-authorised)" } });
if (!res.ok) throw new Error(`${SOURCE} → HTTP ${res.status}`);
const items = parseFeatured(await res.text());
console.log(`read ${items.length} featured products (${items.filter((i) => i.bestSeller).length} best sellers, ${items.filter((i) => i.priceWas).length} on offer)`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: SOURCE, syncedAt: new Date().toISOString(), items }, null, 2) + "\n");
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);

// ---- prices ---------------------------------------------------------------
const { PrismaClient } = await import(
  process.env.PRISMA_CLIENT_DIR
    ? `file:///${process.env.PRISMA_CLIENT_DIR.replace(/\\/g, "/")}/index.js`
    : "@prisma/client"
);
const db = new PrismaClient();
const rows = await db.product.findMany({
  where: { productCode: { in: items.map((i) => i.code) } },
  select: { id: true, productCode: true, priceNow: true, priceWas: true, saving: true, adminOverrideFields: true },
});
const have = new Map(rows.map((r) => [r.productCode, r]));

let changed = 0, locked = 0, missing = 0;
for (const it of items) {
  const p = have.get(it.code);
  if (!p) { missing++; console.log(`  MISSING  ${it.code} — not in the local catalogue`); continue; }
  const ovr = new Set((p.adminOverrideFields) || []);
  if (ovr.has("priceNow")) { locked++; console.log(`  LOCKED   ${it.code} — admin override, left alone`); continue; }
  const priceWas = it.priceWas && it.price && it.priceWas > it.price ? it.priceWas : null;
  const same = p.priceNow === it.price && p.priceWas === priceWas;
  if (same || it.price === null) continue;
  changed++;
  console.log(`  ${APPLY ? "APPLY " : "WOULD "}  ${String(it.code).padEnd(15)} £${p.priceNow} → £${it.price}${priceWas ? ` (was £${priceWas})` : ""}`);
  if (!APPLY) continue;
  const data = { priceNow: it.price, priceWas };
  const saving = priceWas ? Math.round((priceWas - it.price) * 100) / 100 : null;
  data.saving = saving;
  await db.product.update({ where: { id: p.id }, data });
}
console.log(`${APPLY ? "applied" : "would change"} ${changed}; locked ${locked}; missing ${missing}`);
await db.$disconnect();
