/**
 * Move appliances that were misfiled into Small Appliances > Cookware.
 *
 *   node scripts/catalog/reclassify-cookware.mjs [--apply]
 *
 * taxonomy.mjs rule #12 used to fire on the bare word "cookware", which appears
 * in ordinary appliance marketing copy ("suitable for all cookware"), 36 rules
 * above /cooker/ and /microwave/. Cookers, dishwashers, hobs and a solo
 * microwave therefore landed in Cookware and were invisible in their own
 * departments. The rule is now narrowed, but classify() only runs at import
 * time, so nothing already stored moves on its own — this is that repair.
 *
 * Deliberately scoped to products SITTING IN Cookware: it can only move things
 * out of the known dumping ground, never re-file the rest of the catalogue.
 * Dry run unless --apply. A product whose category was set by hand in the admin
 * is skipped — the owner's own filing always wins.
 */
import { createRequire } from "module";
import { classify, LEAF } from "./taxonomy.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

const APPLY = process.argv.includes("--apply");
// Cookware is the known dumping ground, but the stale dev snapshot also has the
// Quooker range sitting in Kettles, so the shelf to sweep is an argument.
const fromIdx = process.argv.indexOf("--from");
const FROM = fromIdx > -1 ? process.argv[fromIdx + 1] : "Cookware";
const db = new PrismaClient();
try {
  const rows = await db.product.findMany({
    where: { subcategory: FROM },
    select: { id:true, brand:true, productCode:true, title:true, descriptionText:true,
              category:true, subcategory:true, adminOverrideFields:true },
  });

  const hitName = (leaf) => LEAF.get(leaf)?.leafName;
  const moves = [];
  let kept = 0, owned = 0;
  for (const p of rows) {
    const ovr = Array.isArray(p.adminOverrideFields) ? p.adminOverrideFields : [];
    if (ovr.includes("category") || ovr.includes("subcategory")) { owned++; continue; }
    const name = `${p.brand} ${p.title}`.trim();
    let leaf;
    try { leaf = classify({ name, description: p.descriptionText || name, source: "ruislip", key: p.productCode }).leaf; }
    catch { kept++; continue; }          // unclassifiable -> leave exactly where it is
    if (hitName(leaf) === FROM) { kept++; continue; }
    const hit = LEAF.get(leaf);
    if (!hit) { kept++; continue; }
    moves.push({ p, category: hit.topName, subcategory: hit.leafName });
  }

  console.log(`${rows.length} products in ${FROM} | ${kept} genuinely belong | ${owned} set by hand (skipped) | ${moves.length} to move${APPLY ? "" : "   (DRY RUN)"}\n`);
  for (const m of moves) {
    console.log(`  ${m.p.category} > ${m.p.subcategory}  ->  ${m.category} > ${m.subcategory}`);
    console.log(`      ${m.p.brand} ${m.p.productCode} — ${m.p.title.slice(0, 62)}`);
    if (APPLY) {
      await db.product.update({
        where: { id: m.p.id },
        data: { category: m.category, subcategory: m.subcategory, breadcrumbs: [m.category, m.subcategory] },
      });
    }
  }
  console.log(APPLY
    ? `\nMoved ${moves.length}. Now run: node scripts/catalog/recompute-counts.mjs`
    : `\n(dry run — nothing written; re-run with --apply)`);
} finally { await db.$disconnect(); }
