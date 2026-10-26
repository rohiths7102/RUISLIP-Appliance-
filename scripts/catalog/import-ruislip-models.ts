/**
 * Add the Bosch, Neff and Siemens models Ruislip Appliances sells that are not
 * on our site (Pricewire's "Sold by them, not by us", Oct 2026). Everything
 * comes from Ruislip Appliances' own published pages, which Sachin's friend
 * there is happy for us to read: title, description and specification table
 * from the Markdown page, EAN and photos from the product page. Photos are
 * saved into public/catalog/<brand>/<code>/ like the rest of the catalogue —
 * never hotlinked to their server.
 *
 *   tsx scripts/catalog/import-ruislip-models.ts [--dry-run] [--brand Neff] [--limit 5]
 *
 * New products arrive as call for price; their price then comes from the
 * Pricewire read and Apply, like every other Bosch, Neff and Siemens line, so
 * it is checked and audit-logged the same way. A code already on the site
 * (visible or hidden) is never added again.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectJsonLdProducts } from "../../lib/page-reader";
import { parseListSite, brandOf } from "../../lib/price-watch/pricewire";
import { ruislipType } from "./ruislip-types";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const ONLY = opt("--brand");
const LIMIT = Number(opt("--limit") || Infinity);
const LIST = "https://www.ruislipappliances.com/llms-full.txt";
const BY = "Rohit (via Claude): Bosch/Neff/Siemens models from Ruislip Appliances, Oct 2026";
const UA = "JyotsnaElectricalBot/1.0 (+product import; contact rohith@kroneuszerotrust.com)";
const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (url: string) => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r;
};

/** The Markdown page: "- Key: value" lines, a description and a | Feature | Value | table. */
function parseMd(md: string) {
  const field = (k: string) => md.match(new RegExp(`^- ${k}: (.+)$`, "m"))?.[1].trim() ?? "";
  const description = (md.split(/^## Description\s*$/m)[1] || "").split(/^## /m)[0].replace(/\s+/g, " ").trim();
  const table = (md.split(/^## Specification\s*$/m)[1] || "").split(/^## /m)[0];
  const specifications = table.split(/\r?\n/).map((l) => l.match(/^\|\s*(.+?)\s*\|\s*(.*?)\s*\|$/)).filter(Boolean)
    .map((m) => ({ label: m![1].trim(), value: m![2].trim() }))
    .filter((s) => s.label && s.value && !/^-+$/.test(s.label) && s.label !== "Feature" && !/^(EAN|IAN)$/i.test(s.label));
  return { brand: field("Brand"), category: field("Category"), ean: field("EAN / GTIN").replace(/\D/g, ""), description, specifications };
}

async function main() {
  const { createRequire } = await import("node:module");
  const { PrismaClient } = createRequire(`${process.cwd()}/`)(process.env.PRISMA_CLIENT_DIR || "@prisma/client");
  const { LEAF } = await import("./taxonomy.mjs");
  const sharp = (await import("sharp")).default;
  const db = new PrismaClient();

  const list = parseListSite(await (await get(LIST)).text());
  const ours = new Set((await db.product.findMany({ select: { productCode: true } })).map((p: any) => norm(p.productCode)));
  const todo = [...list.values()].filter((l) => l.brand && !ours.has(norm(l.code)) && (!ONLY || l.brand === ONLY)).slice(0, LIMIT);
  console.log(`${todo.length} models to add${DRY ? " (dry run)" : ""}`);
  const tally = { added: 0, skipped: 0, photos: 0 };

  for (const l of todo) {
    try {
      const base = `https://www.ruislipappliances.com/products/${encodeURIComponent(l.code)}`;
      const md = parseMd(await (await get(`${base}.md`)).text());
      const ld = collectJsonLdProducts(await (await get(`${base}.htm`)).text()).find((p) => norm(p.sku) === norm(l.code) || norm(p.mpn) === norm(l.code));
      const brand = brandOf(md.brand) ?? l.brand!;
      const code = l.code.toUpperCase();
      // Their titles repeat the brand and code ("SIEMENSIQ500 … ED851HQ26E - …"); ours carry them separately.
      const title = String(ld?.name || l.title).replace(new RegExp(`\\b${brand}\\b`, "ig"), "").replace(new RegExp(`\\b${code}\\b`, "ig"), "")
        .replace(/^SIEMENS(?=iQ)/i, "").replace(/(\s*-\s*){2,}/g, " - ").replace(/\s+-\s+/g, " - ").replace(/\s{2,}/g, " ").replace(/^[\s-]+|[\s-]+$/g, "").slice(0, 140) || l.title;
      const type = ruislipType(l.section, md.category, title);
      const leaf = type ? LEAF.get(type) : null;
      const images: string[] = (Array.isArray(ld?.image) ? ld.image : ld?.image ? [ld.image] : []).map(String).slice(0, 6);
      console.log(`  ${DRY ? "would add" : "add"} ${brand.padEnd(7)} ${code.padEnd(12)} ${title.slice(0, 48).padEnd(48)} → ${leaf ? `${leaf.topName} › ${leaf.leafName}` : `NOT PLACED (${l.section} / ${md.category})`} | ${images.length} photos, ${md.specifications.length} specs`);
      if (!leaf) { tally.skipped++; continue; }
      if (DRY) { await sleep(250); continue; }

      const dir = join("public", "catalog", brand.toLowerCase(), code);
      mkdirSync(dir, { recursive: true });
      const saved: string[] = [];
      for (const [i, src] of images.entries()) {
        try {
          const buf = Buffer.from(await (await get(src)).arrayBuffer());
          const name = `${String(i + 1).padStart(2, "0")}.webp`;
          writeFileSync(join(dir, name), await sharp(buf).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer());
          saved.push(`/catalog/${brand.toLowerCase()}/${code}/${name}`);
        } catch (e: any) { console.log(`    photo ${i + 1} not saved: ${e.message}`); }
        await sleep(150);
      }
      tally.photos += saved.length;

      let slug = `${brand.toLowerCase()}-${code.toLowerCase()}`;
      for (let i = 2; await db.product.findUnique({ where: { slug } }); i++) slug = `${brand.toLowerCase()}-${code.toLowerCase()}-${i}`;
      const description = md.description || String(ld?.description || title).replace(/\s+/g, " ").trim();
      const created = await db.product.create({ data: {
        sourceUrl: `${base}.htm`, oldUrl: "", slug, title, brand, productCode: code, gtin: md.ean || String(ld?.gtin || "").replace(/\D/g, ""),
        category: leaf.topName, subcategory: leaf.leafName, breadcrumbs: [leaf.topName, leaf.leafName], categoryId: leaf.leafId,
        priceNow: null, priceWas: null, saving: null, currency: "GBP",
        availabilityRaw: "", availabilityNormalised: "call_to_confirm",
        warranty: "", shortDescription: description.slice(0, 400), descriptionText: description, descriptionHtml: "",
        specifications: md.specifications, features: [], energyLabelUrl: "",
        mainImage: saved[0] || "", galleryImages: saved, relatedProductCodes: [], serviceAddOns: [], deliveryNotes: "",
        seoTitle: `${brand} ${code} ${title}`.slice(0, 120), seoDescription: `${brand} ${code} — ${title}. Call 0208 864 5763 to confirm price, availability and delivery.`.slice(0, 300),
        lastScrapedAt: new Date(), isVisible: true, featured: false, agencyStock: false, adminOverrideFields: [],
      } });
      await db.adminAuditLog.create({ data: { entityType: "product", entityId: created.id, action: "create", changedFields: ["*"],
        previousValue: {}, newValue: { productCode: code, title, brand, sourceUrl: `${base}.htm`, photos: saved.length }, changedBy: BY } });
      tally.added++;
      await sleep(250);
    } catch (e: any) {
      tally.skipped++;
      console.log(`  skip ${l.code}: ${String(e?.message || e).replace(/\s+/g, " ").slice(-300)}`);
    }
  }
  console.log(`done: ${tally.added} added, ${tally.skipped} skipped, ${tally.photos} photos saved`);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
