/**
 * Add Bosch or Neff models from the makers' own pages: title, photos, the full
 * spec list, EAN, and the maker's price where the page shows one (none, e.g. a
 * model they have stopped selling, = call for price). Written for Sachin's
 * best sellers that were not on the site (30 Sept 2026); any model will do.
 *
 *   node scripts/db/with-prod-db.mjs scripts/catalog/import-maker-models.ts [--dry-run] CODE=URL …
 *
 * URL is the model's page on bosch-home.co.uk or neff-home.com, with its
 * category path: the category comes from it through the same taxonomy as every
 * other Bosch/Neff line. The page must name the model in its own mpn — the
 * makers answer any path that ends in a code.
 *
 * A code already on the site is not added again. If its sourceUrl is not the
 * maker's page (four of Sachin's Neff picks pointed at ruislipappliances.com,
 * so the daily maker read never saw them), it is pointed at the maker's page;
 * nothing else about it changes.
 */
import { fetchPage, collectJsonLdProducts } from "../../lib/page-reader";
import { readMakerPrice, MAKER_HOSTS } from "../../lib/maker-price";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const pairs = args.filter((a) => a.includes("=")).map((a) => { const i = a.indexOf("="); return { code: a.slice(0, i).toUpperCase(), url: a.slice(i + 1) }; });
const BY = "Rohit (via Claude): Sachin's best sellers, 30 Sept 2026";
const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Works whether tsx runs this as ESM or CJS: no bare require, no import.meta.
  const { createRequire } = await import("node:module");
  const { PrismaClient } = createRequire(`${process.cwd()}/`)(process.env.PRISMA_CLIENT_DIR || "@prisma/client");
  const { classify, LEAF } = await import("./taxonomy.mjs");
  const db = new PrismaClient();
  if (!pairs.length) throw new Error("usage: import-maker-models.ts [--dry-run] CODE=URL …");

  for (const { code, url } of pairs) {
    const host = new URL(url).hostname;
    if (!MAKER_HOSTS.test(host)) { console.log(`  skip ${code}: ${host} is not Bosch's or Neff's site`); continue; }
    const brand = /neff/i.test(host) ? "Neff" : "Bosch";
    const { html } = await fetchPage(url);
    const ld = collectJsonLdProducts(html).find((p) => norm(p.mpn) === code || norm(p.sku) === code);
    if (!ld) { console.log(`  skip ${code}: the page does not name ${code}`); continue; }
    const read = readMakerPrice(html, code);
    const price = read.price;

    const existing = await db.product.findMany({ where: { productCode: code, brand } });
    if (existing.length) {
      for (const p of existing) {
        let onMaker = false;
        try { onMaker = MAKER_HOSTS.test(new URL(p.sourceUrl).hostname); } catch { /* not a URL */ }
        if (onMaker) { console.log(`  keep ${code}: already on the site with its maker page`); continue; }
        console.log(`  ${DRY ? "would point" : "point"} ${code} at ${url} (was ${p.sourceUrl}) — maker shows ${price ?? read.reason}, ours £${p.priceNow ?? "call"}`);
        if (DRY) continue;
        await db.product.update({ where: { id: p.id }, data: { sourceUrl: url } });
        await db.adminAuditLog.create({ data: { entityType: "product", entityId: p.id, action: "update", changedFields: ["sourceUrl"],
          previousValue: { sourceUrl: p.sourceUrl }, newValue: { sourceUrl: url, reason: "the maker's own page, so the daily maker-price read covers it" }, changedBy: BY } });
      }
      await sleep(800);
      continue;
    }

    const leaf = LEAF.get(classify({ key: code, source: brand.toLowerCase(), name: ld.name, description: ld.name, source_url: url }).leaf);
    const images: string[] = (Array.isArray(ld.image) ? ld.image : [ld.image]).map(String).filter((u: string) => /^https:\/\/media3\.bsh-group\.com\//.test(u));
    images.sort((a, b) => Number(/Product_Shots/.test(b)) - Number(/Product_Shots/.test(a))); // the product shot first
    const specs = (Array.isArray(ld.additionalProperty) ? ld.additionalProperty : [])
      .map((s: any) => ({ label: String(s?.name ?? "").trim(), value: String(s?.value ?? "").trim() })).filter((s: any) => s.label && s.value);
    const title = String(ld.name).replace(/\s+/g, " ").trim();
    let slug = `${brand.toLowerCase()}-${code.toLowerCase()}`;
    for (let i = 2; await db.product.findUnique({ where: { slug } }); i++) slug = `${brand.toLowerCase()}-${code.toLowerCase()}-${i}`;

    console.log(`  ${DRY ? "would add" : "add"} ${brand} ${code.padEnd(11)} ${title.slice(0, 50).padEnd(50)} → ${leaf.topName} › ${leaf.leafName} | ${price !== null ? `£${price}` : `call for price (${read.reason})`} | ${images.length} photos, ${specs.length} specs`);
    if (DRY) { await sleep(800); continue; }
    const created = await db.product.create({ data: {
      sourceUrl: url, oldUrl: "", slug, title, brand, productCode: code, gtin: String(ld.gtin13 || ld.gtin || "").replace(/\D/g, ""),
      category: leaf.topName, subcategory: leaf.leafName, breadcrumbs: [leaf.topName, leaf.leafName], categoryId: leaf.leafId,
      priceNow: price, priceWas: null, saving: null, currency: "GBP",
      availabilityRaw: price !== null ? "Available to order" : "", availabilityNormalised: price !== null ? "to_order" : "call_to_confirm",
      warranty: "", shortDescription: String(ld.description || title).slice(0, 400), descriptionText: String(ld.description || title), descriptionHtml: "",
      specifications: specs, features: [], energyLabelUrl: "",
      mainImage: images[0] || "", galleryImages: images.slice(0, 8), relatedProductCodes: [], serviceAddOns: [], deliveryNotes: "",
      seoTitle: `${brand} ${title}`, seoDescription: `${brand} ${code} — ${title}. Call 0208 864 5763 to confirm price, availability and delivery.`,
      lastScrapedAt: new Date(), isVisible: true, featured: false, agencyStock: false, adminOverrideFields: [],
    } });
    await db.adminAuditLog.create({ data: { entityType: "product", entityId: created.id, action: "create", changedFields: ["*"],
      previousValue: {}, newValue: { productCode: code, title, priceNow: price, sourceUrl: url }, changedBy: BY } });
    // Where the price came from, in Admin → Price watch, like every other maker read.
    if (price !== null) await db.priceObservation.create({ data: { productId: created.id, sourceId: "manufacturer-rrp", price, deliveryCost: null,
      inStock: read.price !== null ? read.inStock : null, includesVat: true, sourceUrl: url, matchConfidence: 1, status: "ok", note: "maker page (import)" } });
    await sleep(800);
  }
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
