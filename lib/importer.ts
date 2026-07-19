import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DATA = join(process.cwd(), "data");
const read = (f: string): any[] => { const p = join(DATA, f); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : []; };
const readObj = (f: string): any => { const p = join(DATA, f); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {}; };
const slugOf = (s: string) => s.replace(/^\/products\//, "");
const SCRAPE_OWNED = new Set(["title", "priceNow", "priceWas", "saving", "availabilityRaw", "availabilityNormalised", "warranty", "shortDescription", "mainImage"]);

function mapProduct(p: any, categoryId: string | null) {
  return {
    sourceUrl: p.sourceUrl, oldUrl: p.oldUrl, slug: slugOf(p.newSlug), title: p.title, brand: p.brand, productCode: p.productCode,
    category: p.category || "", subcategory: p.subcategory || "", breadcrumbs: p.breadcrumbs || [],
    priceNow: p.priceNow ?? null, priceWas: p.priceWas ?? null, saving: p.saving ?? null, currency: p.currency || "GBP",
    availabilityRaw: p.availability || "", availabilityNormalised: p.availabilityNormalised || "call_to_confirm", warranty: p.warranty || "",
    shortDescription: p.shortDescription || "", descriptionHtml: p.descriptionHtml || "", descriptionText: p.descriptionText || "",
    specifications: p.specifications || [], features: p.features || [], energyLabelUrl: p.energyLabelUrl || "",
    mainImage: p.image || "", galleryImages: p.gallery || [], relatedProductCodes: (p.relatedProducts || []).map((r: any) => r.productCode).filter(Boolean),
    serviceAddOns: p.services || [], deliveryNotes: p.deliveryNotes || "", seoTitle: p.seoTitle || "", seoDescription: p.seoDescription || "",
    lastScrapedAt: new Date(p.scrapedAt || Date.now()), categoryId,
  };
}

export interface ImportDiff { newProducts: { code: string; title: string }[]; priceChanges: { code: string; from: number | null; to: number | null }[]; availabilityChanges: { code: string; from: string; to: string }[]; removed: { code: string; title: string }[]; locked: number; }

export async function previewImport(db: any): Promise<ImportDiff> {
  const products = read("products.json");
  const existing = await db.product.findMany({ select: { slug: true, productCode: true, title: true, priceNow: true, availabilityNormalised: true, adminOverrideFields: true } });
  const bySlug = new Map<string, any>(existing.map((e: any) => [e.slug, e]));
  const incomingSlugs = new Set<string>();
  const diff: ImportDiff = { newProducts: [], priceChanges: [], availabilityChanges: [], removed: [], locked: 0 };
  for (const p of products) {
    const slug = slugOf(p.newSlug); incomingSlugs.add(slug);
    const cur = bySlug.get(slug);
    if (!cur) { diff.newProducts.push({ code: p.productCode, title: p.title }); continue; }
    const locked: string[] = cur.adminOverrideFields || [];
    if (locked.length) diff.locked++;
    if (!locked.includes("priceNow") && (p.priceNow ?? null) !== cur.priceNow) diff.priceChanges.push({ code: p.productCode, from: cur.priceNow, to: p.priceNow ?? null });
    const av = p.availabilityNormalised || "call_to_confirm";
    if (!locked.includes("availabilityNormalised") && av !== cur.availabilityNormalised) diff.availabilityChanges.push({ code: p.productCode, from: cur.availabilityNormalised, to: av });
  }
  for (const e of existing) if (!incomingSlugs.has(e.slug)) diff.removed.push({ code: e.productCode, title: e.title });
  return diff;
}

export async function applyImport(db: any, changedBy = "scrape"): Promise<{ created: number; updated: number; failed: number; removed: number }> {
  const products = read("products.json"), categories = read("categories.json"), brands = read("brands.json");
  const business = readObj("business.json"), services = read("services.json");
  const job = await db.scrapeJob.create({ data: { status: "running", errors: [] } });
  let created = 0, updated = 0, failed = 0;

  await db.businessInfo.upsert({ where: { id: "business" }, update: {}, create: {
    id: "business", businessName: business.businessName, tradingName: business.tradingName, phone: business.phone, email: business.email || "",
    address: business.address, openingHours: business.openingHours, deliveryRadius: business.delivery?.radius || "", deliveryNotes: business.delivery?.notes || "",
    socialLinks: business.socialLinks || [], services, mapQuery: business.mapQuery || "", googleMapsEmbedUrl: business.googleMapsEmbedUrl || "", googleMapsDirectionsUrl: business.googleMapsDirectionsUrl || "",
  } });
  for (const c of [...categories].sort((a: any, b: any) => (a.parentCategory ? 1 : 0) - (b.parentCategory ? 1 : 0)))
    await db.category.upsert({ where: { id: c.id }, update: { name: c.name, slug: c.slug, productCount: c.productCount, parentId: c.parentCategory || null },
      create: { id: c.id, name: c.name, slug: c.slug, sourceUrl: c.sourceUrl || "", parentId: c.parentCategory || null, description: c.description || "", image: c.image || "", productCount: c.productCount || 0, seoTitle: c.seoTitle || "", seoDescription: c.seoDescription || "" } });
  for (const b of brands)
    await db.brand.upsert({ where: { id: b.id }, update: { logo: b.logo, productCount: b.productCount }, create: { id: b.id, name: b.name, slug: b.slug, sourceUrl: b.sourceUrl || "", logo: b.logo || "", productCount: b.productCount || 0 } });
  for (const s of services)
    await db.serviceAddOn.upsert({ where: { id: s.id }, update: {}, create: { id: s.id, name: s.name, description: s.description || "", price: s.price ?? null, optional: s.optional ?? true, appliesToCategory: s.appliesToCategory || "" } });

  const catByName = new Map<string, string>((await db.category.findMany()).map((c: any) => [c.name.toLowerCase(), c.id]));
  for (const p of products) {
    try {
      const slug = slugOf(p.newSlug);
      const categoryId = catByName.get((p.subcategory || "").toLowerCase()) || catByName.get((p.category || "").toLowerCase()) || null;
      const scraped = mapProduct(p, categoryId);
      const existing = await db.product.findUnique({ where: { slug } });
      if (!existing) { await db.product.create({ data: { ...scraped, adminOverrideFields: [] } }); created++; }
      else {
        const locked = new Set<string>((existing.adminOverrideFields as string[]) || []);
        const data: Record<string, any> = {};
        for (const [k, v] of Object.entries(scraped)) if (!locked.has(k)) data[k] = v;
        await db.product.update({ where: { slug }, data }); updated++;
      }
    } catch { failed++; }
  }
  const incoming = new Set<string>(products.map((p: any) => slugOf(p.newSlug)));
  const removed = (await db.product.findMany({ select: { slug: true } })).filter((r: any) => !incoming.has(r.slug)).length;
  await db.scrapeJob.update({ where: { id: job.id }, data: { status: "completed", finishedAt: new Date(), pagesFound: products.length, pagesScraped: products.length, productsFound: products.length, productsCreated: created, productsUpdated: updated, productsFailed: failed, reportPath: "data/scrape-report.json" } });
  return { created, updated, failed, removed };
}
