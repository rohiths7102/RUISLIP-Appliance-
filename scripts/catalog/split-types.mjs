/**
 * The finer classifications Sachin asked for (16 Oct 2026, from his ChatGPT
 * list): freestanding vs integrated laundry and refrigeration, the dishwasher
 * fittings, single/double/built-under ovens, hobs by fuel, range cookers, sinks
 * by material, taps by kind. Also re-files products that sit in the wrong type
 * (an integrated dishwasher under Freestanding, cordless vacuums under Vacuum
 * Cleaners, a television under Blu-ray).
 *
 *   PRISMA_CLIENT_DIR=… node scripts/db/with-prod-db.mjs scripts/catalog/split-types.mjs [--apply] [--backup=file.json]
 *
 * Dry run by default: prints where every product would go. Each product is
 * read from its own title (and, where the maker gave it, its "Built-in /
 * Free-standing" spec); a product with no signal stays in the type it is in
 * now. Existing types keep their id, so every /categories/<id> link still
 * works: the larger half of a split keeps the old row under its finer name.
 * New types are created only when something lands in them. With --apply it
 * writes a backup first, then the categories, then the products (one audit
 * row each). Afterwards run recompute-counts.mjs.
 */
import { createRequire } from "module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const APPLY = process.argv.includes("--apply");
const BACKUP = (process.argv.find((a) => a.startsWith("--backup=")) || "").slice(9);
if (APPLY && !BACKUP) { console.error("--apply needs --backup=<file.json>"); process.exit(1); }

// Existing rows that become the larger half: id → finer name (the id, and so the URL, stays).
const RENAME = {
  "washing-machines": "Freestanding Washing Machines", "washer-dryers": "Freestanding Washer Dryers",
  "fridge-freezers": "Freestanding Fridge Freezers", "fridges": "Freestanding Fridges", "freezers": "Freestanding Freezers",
  "integrated-dishwashers": "Fully Integrated Dishwashers", "ovens": "Single Ovens", "hobs": "Induction Hobs",
  "cookers": "Freestanding Cookers", "kitchen-sinks": "Stainless Steel Sinks", "kitchen-taps": "Kitchen Mixer Taps",
};
// New rows: id → [department id, name, order after its sibling].
const CREATE = {
  "integrated-washing-machines": ["laundry", "Integrated Washing Machines"],
  "integrated-washer-dryers": ["laundry", "Integrated Washer Dryers"],
  "integrated-fridge-freezers": ["refrigeration", "Integrated Fridge Freezers"],
  "integrated-fridges": ["refrigeration", "Integrated Fridges"],
  "integrated-freezers": ["refrigeration", "Integrated Freezers"],
  "chest-freezers": ["refrigeration", "Chest Freezers"],
  "slimline-dishwashers": ["dishwashers", "Slimline Dishwashers"],
  "semi-integrated-dishwashers": ["dishwashers", "Semi-integrated Dishwashers"],
  "integrated-slimline-dishwashers": ["dishwashers", "Integrated Slimline Dishwashers"],
  "table-top-dishwashers": ["dishwashers", "Table-top Dishwashers"],
  "double-ovens": ["cooking", "Double Ovens"],
  "built-under-ovens": ["cooking", "Built-under Double Ovens"],
  "compact-ovens": ["cooking", "Compact Ovens"],
  "gas-hobs": ["cooking", "Gas Hobs"],
  "ceramic-hobs": ["cooking", "Ceramic & Electric Hobs"],
  "venting-hobs": ["cooking", "Venting Hobs"],
  "range-cookers": ["cooking", "Range Cookers"],
  "granite-sinks": ["sinks-taps", "Granite & Composite Sinks"],
  "ceramic-sinks": ["sinks-taps", "Ceramic Sinks"],
  "pull-out-taps": ["sinks-taps", "Pull-out & Spray Taps"],
  "filter-taps": ["sinks-taps", "Filter Taps"],
};

const spec = (p, label) => {
  const sp = Array.isArray(p.specifications) ? p.specifications : [];
  return String(sp.find((x) => x && x.label === label)?.value ?? "");
};
// Fitted into a kitchen run? A maker's spec wins; then the title.
function fitted(p) {
  const s = spec(p, "Built-in / Free-standing").toLowerCase();
  if (s.startsWith("built")) return true;
  if (s.startsWith("free")) return false;
  if (/\bfree[- ]?standing\b/i.test(p.title)) return false;
  return /\b(fully[- ]?integrated|semi[- ]?integrated|integrated|integrable|built[- ]?in|built[- ]?under)\b/i.test(p.title);
}
const t = (p) => p.title;

// Each current type → where a product in it belongs (a type id), or null to leave it.
const RULES = {
  "Washing Machines": (p) => (fitted(p) ? "integrated-washing-machines" : "washing-machines"),
  "Washer Dryers": (p) => (fitted(p) ? "integrated-washer-dryers" : "washer-dryers"),
  "Fridge Freezers": (p) => (fitted(p) ? "integrated-fridge-freezers" : "fridge-freezers"),
  "Fridges": (p) => (fitted(p) ? "integrated-fridges" : "fridges"),
  "Freezers": (p) => {
    if (/\bchest\b/i.test(t(p))) return "chest-freezers";
    // a fridge with a freezer compartment is a fridge
    if (/\bfridge\b/i.test(t(p)) && !/fridge[- ]?freezer/i.test(t(p))) return fitted(p) ? "integrated-fridges" : "fridges";
    return fitted(p) ? "integrated-freezers" : "freezers";
  },
  "Freestanding Dishwashers": dishwasher,
  "Integrated Dishwashers": dishwasher,
  "Ovens": (p) => {
    if (/warming drawer/i.test(t(p))) return "warming-drawers";
    if (/microwave/i.test(t(p))) return "microwaves";
    const two = /\bdouble\b/i.test(t(p)) || spec(p, "Usable volume (of cavity) - cavity 2") !== "";
    if (two && /built[- ]?under/i.test(t(p))) return "built-under-ovens";
    if (two) return "double-ovens";
    if (/\bcompact\b|\b45 ?cm\b/i.test(t(p))) return "compact-ovens";
    return "ovens";
  },
  "Hobs": (p) => {
    if (/venting|extract|downdraft|with integrated (hood|extractor)/i.test(t(p))) return "venting-hobs";
    if (/dual fuel|\bgas\b|\blpg\b|\bwok\b/i.test(t(p))) return "gas-hobs";
    if (/induction/i.test(t(p))) return "hobs";
    if (/ceramic|electric|solid plate|radiant|hi-?light/i.test(t(p))) return "ceramic-hobs";
    return null;
  },
  "Cookers": (p) => (/\brange\b|\b(90|100|110|120) ?cm\b/i.test(t(p)) ? "range-cookers" : "cookers"),
  "Kitchen Sinks": (p) => {
    if (/granite|composite|quartz|silgranit|tectonite|cristalite/i.test(t(p))) return "granite-sinks";
    if (/ceramic|belfast|fireclay|butler/i.test(t(p))) return "ceramic-sinks";
    if (/stainless|steel|inset|undermount|worktop|sink/i.test(t(p))) return "kitchen-sinks";
    return null;
  },
  "Kitchen Taps": (p) => {
    if (/boiling/i.test(t(p))) return "boiling-water-taps";
    if (/pull[- ]?(out|down)|spray/i.test(t(p))) return "pull-out-taps";
    if (/filter/i.test(t(p))) return "filter-taps";
    return "kitchen-taps";
  },
  "Vacuum Cleaners": (p) => (/\bcordless\b/i.test(t(p)) ? "cordless-vacuums" : "vacuum-cleaners"),
  "Blu-ray & DVD Players": (p) => (/\b(tv|television|qled|oled)\b/i.test(t(p)) ? "televisions" : "blu-ray-players"),
};
function dishwasher(p) {
  const title = t(p);
  if (/table ?top|countertop|compact dishwasher/i.test(title)) return "table-top-dishwashers";
  const slim = /slimline|\b45 ?cm\b/i.test(title);
  const semi = /semi[- ]?integrated/i.test(title) || /semi/i.test(spec(p, "Installation typology"));
  if (semi) return "semi-integrated-dishwashers";
  if (fitted(p)) return slim ? "integrated-slimline-dishwashers" : "integrated-dishwashers";
  return slim ? "slimline-dishwashers" : "freestanding-dishwashers";
}

const db = new PrismaClient();
const cats = await db.category.findMany();
const byId = new Map(cats.map((c) => [c.id, c]));
for (const id of Object.keys(CREATE)) if (byId.has(id)) { console.error(`category id ${id} already exists — refusing`); process.exit(1); }
for (const id of [...Object.keys(RENAME), "warming-drawers", "microwaves", "boiling-water-taps", "cordless-vacuums", "vacuum-cleaners", "televisions", "blu-ray-players", "freestanding-dishwashers"])
  if (!byId.has(id)) { console.error(`expected category ${id} is missing — refusing`); process.exit(1); }
const deptOf = (id) => byId.get(byId.get(id)?.parentId ?? "")?.name ?? byId.get(CREATE[id]?.[0])?.name;
const nameOf = (id) => RENAME[id] ?? CREATE[id]?.[1] ?? byId.get(id).name;

const products = await db.product.findMany({ where: { subcategory: { in: Object.keys(RULES) } },
  select: { id: true, productCode: true, brand: true, title: true, category: true, subcategory: true, isVisible: true, specifications: true, adminOverrideFields: true } });

const moves = [], left = [];
for (const p of products) {
  const locked = Array.isArray(p.adminOverrideFields) && p.adminOverrideFields.includes("subcategory");
  const to = locked ? null : RULES[p.subcategory](p);
  if (!to) { left.push(p); continue; }
  moves.push({ p, to, category: deptOf(to), subcategory: nameOf(to) });
}

// Report: where things land, visible counts, a few examples each.
const tally = new Map();
for (const m of moves) { const k = `${m.category} › ${m.subcategory}`; const e = tally.get(k) || { all: 0, vis: 0, changed: 0, eg: [] }; e.all++; if (m.p.isVisible) e.vis++; if (m.p.subcategory !== m.subcategory || m.p.category !== m.category) { e.changed++; if (e.eg.length < 4) e.eg.push(`${m.p.brand} ${m.p.title.slice(0, 64)}`); } tally.set(k, e); }
console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${products.length} products in the types being split\n`);
for (const [k, e] of [...tally].sort()) { console.log(`${String(e.vis).padStart(4)} visible  ${k}   (${e.changed} moving in)`); for (const x of e.eg) console.log(`            ↳ ${x}`); }
console.log(`\nleft where they are (no clear signal or locked by an admin edit): ${left.length}`);
for (const p of left) console.log(`   ${p.subcategory.padEnd(16)} ${p.brand} ${p.title.slice(0, 70)}`);
const changing = moves.filter((m) => m.p.subcategory !== m.subcategory || m.p.category !== m.category);
const emptyNew = Object.keys(CREATE).filter((id) => !moves.some((m) => m.to === id && m.p.isVisible));
console.log(`\n${changing.length} products change type; ${Object.keys(RENAME).length} types renamed; ${Object.keys(CREATE).length - emptyNew.length} new types${emptyNew.length ? ` (not created, nothing visible would land: ${emptyNew.join(", ")})` : ""}`);

if (APPLY) {
  writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(),
    categories: cats.filter((c) => RENAME[c.id]).map((c) => ({ id: c.id, name: c.name })),
    products: changing.map((m) => ({ id: m.p.id, code: m.p.productCode, category: m.p.category, subcategory: m.p.subcategory })) }, null, 1));
  console.log(`backup written: ${BACKUP}`);
  const siblings = (dept) => cats.filter((c) => c.parentId === dept);
  for (const [id, [dept, name]] of Object.entries(CREATE)) {
    if (emptyNew.includes(id)) continue;
    const parent = byId.get(dept);
    await db.category.create({ data: { id, name, slug: `/${parent.slug.replace(/^\//, "").split("/")[0] || dept}/${id}`, parentId: dept, order: Math.max(0, ...siblings(dept).map((c) => c.order)) + 1, isVisible: true } });
  }
  for (const [id, name] of Object.entries(RENAME)) await db.category.update({ where: { id }, data: { name } });
  const reason = "finer classifications (Sachin, Oct 2026)";
  for (let i = 0; i < changing.length; i += 50) {
    await db.$transaction(changing.slice(i, i + 50).flatMap((m) => [
      db.product.update({ where: { id: m.p.id }, data: { category: m.category, subcategory: m.subcategory, breadcrumbs: [m.category, m.subcategory], categoryId: m.to } }),
      db.adminAuditLog.create({ data: { entityType: "product", entityId: m.p.id, action: "update", changedFields: ["category", "subcategory"],
        previousValue: { category: m.p.category, subcategory: m.p.subcategory }, newValue: { category: m.category, subcategory: m.subcategory },
        changedBy: `Rohit (via Claude): ${reason}` } }),
    ]));
  }
  // Products in a renamed type that did not move still carry the old name.
  for (const [id, name] of Object.entries(RENAME)) {
    const old = byId.get(id).name;
    if (old !== name) await db.product.updateMany({ where: { subcategory: old }, data: { subcategory: name } });
  }
  console.log("applied. Next: recompute-counts.mjs, then reindex the chatbot.");
}
await db.$disconnect();
