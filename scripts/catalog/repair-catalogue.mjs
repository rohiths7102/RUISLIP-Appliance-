/**
 * Repair the catalogue damage the wave-3 import left behind.
 *
 *   node scripts/catalog/repair-catalogue.mjs                 (dry run — default)
 *   node scripts/catalog/repair-catalogue.mjs --apply
 *
 * To repair PRODUCTION, DATABASE_URL has to point at the Postgres instance. This
 * is a Windows box, so the PowerShell spelling is the one that works in the
 * shell you are most likely holding:
 *
 *   $env:DATABASE_URL="postgres://…"; node scripts/catalog/repair-catalogue.mjs --apply
 *   DATABASE_URL=postgres://… node scripts/catalog/repair-catalogue.mjs --apply     (bash)
 *
 * Easier and safer, because it resolves the production URL out of .env.local and
 * never echoes the credential:
 *
 *   node scripts/db/with-prod-db.mjs scripts/catalog/repair-catalogue.mjs --apply
 *
 * Four faults, all from the same import (see product-title.mjs and
 * stage-import.mjs for the fixes that stop them recurring):
 *
 *   1. TITLES   288 products were titled with nothing but their brand, because
 *               the importer read the drop's "name" field ("Smeg SBC4304X")
 *               and stripped the code out of it. A department page rendered the
 *               word "Smeg" a hundred times. The real name was captured in
 *               shortDescription, so the title is rebuilt from there.
 *   2. BRANDS   Drop folder names minted duplicate brand rows — "Fisher" beside
 *               "Fisher & Paykel", "Russell" beside "Russell Hobbs" — and a
 *               casing split ("NUTRIBULLET" vs "Nutribullet"). Each split the
 *               brand across two pages and two filter entries.
 *   3. EMPTIES  A brand row with no products (the ZZSECTEST leftover) still
 *               renders a tile on /brands and counts toward the homepage stat.
 *   4. COUNTS   Brand.productCount goes stale wherever a casing split hid rows.
 *
 * Anything the owner has already edited by hand is left alone: a product whose
 * adminOverrideFields contains "title" keeps his wording.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "module";
import { buildTitle } from "./product-title.mjs";

const require = createRequire(import.meta.url);
// PRISMA_CLIENT_DIR lets this run against an isolated Postgres client (generated
// to its own directory) without regenerating the shared local sqlite client that
// running dev servers hold open. It is set the same way as DATABASE_URL above:
// $env:PRISMA_CLIENT_DIR="…/pg/client" in PowerShell.
const { PrismaClient } = require(process.env.PRISMA_CLIENT_DIR || "@prisma/client");

for (const f of [".env.local", ".env"]) {
  const fp = join(process.cwd(), f);
  if (!existsSync(fp)) continue;
  for (const line of readFileSync(fp, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const APPLY = process.argv.includes("--apply");
/** Brands the drops truncated or re-cased. Explicit rather than inferred: folding
 *  one maker into another by guesswork would mis-file real stock. */
const BRAND_MERGES = { Fisher: "Fisher & Paykel", Russell: "Russell Hobbs", NUTRIBULLET: "Nutribullet" };

const db = new PrismaClient();
const plan = { titles: [], brands: [], emptyBrands: [], skippedOwnerEdited: 0 };

try {
  const products = await db.product.findMany({
    select: { id: true, title: true, brand: true, productCode: true, shortDescription: true, adminOverrideFields: true },
  });

  // ---- 1. titles ------------------------------------------------------------
  for (const p of products) {
    const brand = (p.brand || "").trim();
    if (!brand || p.title.trim().toLowerCase() !== brand.toLowerCase()) continue;
    const locked = Array.isArray(p.adminOverrideFields) ? p.adminOverrideFields : [];
    if (locked.includes("title")) { plan.skippedOwnerEdited++; continue; }
    const title = buildTitle({ description: p.shortDescription, name: p.title }, brand, p.productCode);
    if (title && title.toLowerCase() !== brand.toLowerCase()) plan.titles.push({ id: p.id, code: p.productCode, from: p.title, to: title });
  }

  // ---- 2. brand merges ------------------------------------------------------
  const brands = await db.brand.findMany({ select: { id: true, name: true, slug: true, productCount: true } });
  const byName = new Map(brands.map((b) => [b.name, b]));
  for (const [wrong, right] of Object.entries(BRAND_MERGES)) {
    const to = byName.get(right);
    if (!to) continue; // this catalogue never carried the canonical brand
    // Matched the same way every other brand comparison here is — a product
    // stored as "FISHER" or "Fisher " is the same damage and has to move with
    // the rest, or it is left pointing at a brand row that is about to go.
    const moving = products.filter((p) => (p.brand || "").trim().toLowerCase() === wrong.trim().toLowerCase());
    // The bad spelling may exist only on the products (a casing split like
    // NUTRIBULLET, where the brand row was already correct) or as its own row
    // too (a truncation like "Fisher"). Repair either shape.
    const from = byName.get(wrong);
    if (!moving.length && !from) continue;
    plan.brands.push({
      from: wrong, to: right,
      products: moving.map((p) => p.productCode),
      movingIds: moving.map((p) => p.id),
      removeBrandId: from?.id || null,
    });
  }

  // ---- 3. brand rows with nothing behind them -------------------------------
  // Counted against the brand each product will carry AFTER the merges above,
  // not the spelling it carries now: a merge target ("Fisher & Paykel") that
  // owns nothing yet is about to be handed the stock still labelled "Fisher",
  // and scoring it on the pre-merge snapshot would hide the page the very next
  // step just filled. A target is never treated as empty for the same reason.
  const merged = new Set(plan.brands.map((b) => b.from.trim().toLowerCase()));
  const mergeTargets = new Set(plan.brands.map((b) => b.to.trim().toLowerCase()));
  const afterMerge = new Map();
  for (const b of plan.brands) for (const id of b.movingIds) afterMerge.set(id, b.to);
  const emptyMergeTargets = [];
  for (const b of brands) {
    const name = b.name.trim().toLowerCase();
    if (merged.has(name)) continue;
    const live = products.filter((p) => (afterMerge.get(p.id) || p.brand || "").trim().toLowerCase() === name).length;
    if (live !== 0) continue;
    if (mergeTargets.has(name)) emptyMergeTargets.push(b.name);
    else plan.emptyBrands.push({ id: b.id, name: b.name, storedCount: b.productCount });
  }

  // ---- report ---------------------------------------------------------------
  console.log(`${APPLY ? "APPLYING" : "DRY RUN — nothing will be written"}\n`);
  console.log(`titles to rebuild : ${plan.titles.length}`);
  for (const t of plan.titles.slice(0, 12)) console.log(`   ${t.code}  "${t.from}"  ->  "${t.to}"`);
  if (plan.titles.length > 12) console.log(`   … and ${plan.titles.length - 12} more`);
  if (plan.skippedOwnerEdited) console.log(`   (${plan.skippedOwnerEdited} left alone — the owner has edited the title)`);

  console.log(`\nbrand rows to merge: ${plan.brands.length}`);
  for (const b of plan.brands) console.log(`   "${b.from}" -> "${b.to}"  (${b.products.length} product${b.products.length === 1 ? "" : "s"}: ${b.products.join(", ")})`);

  console.log(`\nempty brand rows to hide: ${plan.emptyBrands.length}`);
  for (const b of plan.emptyBrands) console.log(`   ${b.name} (stored count ${b.storedCount}, actual 0)`);
  if (plan.brands.length) console.log(`   (counted after the merges above — a brand receiving stock is not empty)`);
  for (const n of emptyMergeTargets) console.log(`   (${n} holds 0 products but is a merge target — left visible)`);

  if (!APPLY) {
    console.log(`\nRe-run with --apply to write these changes.`);
  } else {
    for (const t of plan.titles) await db.product.update({ where: { id: t.id }, data: { title: t.to } });

    for (const b of plan.brands) {
      // Re-brand the products first, then retire the row they no longer need.
      // Addressed by id because the rows were matched case-insensitively — a
      // where-clause on the old brand string would skip the very variants
      // ("FISHER", "Fisher ") this is here to rescue.
      for (const id of b.movingIds) await db.product.update({ where: { id }, data: { brand: b.to } });
      if (b.removeBrandId) {
        // Brand has no relation to Product — products carry a plain string — so
        // this delete cannot cascade. The danger is the opposite one: a product
        // left holding the old spelling would point at a row that no longer
        // exists, so prove against the live table that none do before removing it.
        const held = (await db.product.findMany({ select: { productCode: true, brand: true } }))
          .filter((p) => (p.brand || "").trim().toLowerCase() === b.from.trim().toLowerCase());
        if (held.length) {
          console.error(`✗ kept brand row "${b.from}" — ${held.length} product(s) still carry it: ${held.map((p) => p.productCode).join(", ")}`);
        } else {
          try {
            await db.brand.delete({ where: { id: b.removeBrandId } });
          } catch (e) {
            console.error(`✗ could not delete brand row "${b.from}": ${e.message}`);
          }
        }
      }
    }

    // Hidden, not deleted: an empty brand row may be one the owner is about to
    // stock, and hiding is reversible from the admin.
    for (const b of plan.emptyBrands) await db.brand.update({ where: { id: b.id }, data: { isVisible: false } });

    // ---- 4. counts, recomputed over visible stock, case-insensitively --------
    const fresh = await db.product.findMany({ select: { brand: true, category: true, subcategory: true, isVisible: true } });
    const visible = fresh.filter((p) => p.isVisible);
    for (const b of await db.brand.findMany({ select: { id: true, name: true } })) {
      const n = visible.filter((p) => (p.brand || "").toLowerCase() === b.name.toLowerCase()).length;
      await db.brand.update({ where: { id: b.id }, data: { productCount: n } });
    }
    for (const c of await db.category.findMany({ select: { id: true, name: true, parentId: true } })) {
      const n = visible.filter((p) => (c.parentId ? p.subcategory : p.category) === c.name).length;
      await db.category.update({ where: { id: c.id }, data: { productCount: n } });
    }

    // `npm run rag:build` reads through loadCatalog, which is bound to the local
    // sqlite client — after a production repair it would rebuild the wrong index.
    console.log(`\ndone. Rebuild the chatbot index so it learns the corrected names:`);
    console.log(`   local : npm run rag:build`);
    console.log(`   prod  : node scripts/db/with-prod-db.mjs scripts/rag/rebuild-from-db.ts`);
  }
} finally {
  await db.$disconnect();
}
