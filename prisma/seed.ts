import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const db = new PrismaClient();
const read = (f: string) => JSON.parse(readFileSync(join(process.cwd(), "data", f), "utf8"));
const slugOf = (newSlug: string) => newSlug.replace(/^\/products\//, "");

async function main() {
  const products = read("products.json");
  const categories = read("categories.json");
  const brands = read("brands.json");
  const business = read("business.json");
  const services = read("services.json");

  // Business singleton
  await db.businessInfo.upsert({
    where: { id: "business" },
    update: {},
    create: {
      id: "business",
      businessName: business.businessName, tradingName: business.tradingName,
      phone: business.phone, email: business.email || "",
      address: business.address, openingHours: business.openingHours,
      deliveryRadius: business.delivery?.radius || "", deliveryNotes: business.delivery?.notes || "",
      socialLinks: business.socialLinks || [], services: services || [],
      mapQuery: business.mapQuery || "", googleMapsEmbedUrl: business.googleMapsEmbedUrl || "",
      googleMapsDirectionsUrl: business.googleMapsDirectionsUrl || "",
    },
  });

  // Categories: parents first so self-relation FK resolves
  const sorted = [...categories].sort((a: any, b: any) => (a.parentCategory ? 1 : 0) - (b.parentCategory ? 1 : 0));
  for (const c of sorted) {
    await db.category.upsert({
      where: { id: c.id },
      update: { name: c.name, slug: c.slug, productCount: c.productCount, parentId: c.parentCategory || null },
      create: {
        id: c.id, name: c.name, slug: c.slug, sourceUrl: c.sourceUrl || "",
        parentId: c.parentCategory || null, description: c.description || "",
        image: c.image || "", productCount: c.productCount || 0,
        seoTitle: c.seoTitle || "", seoDescription: c.seoDescription || "",
      },
    });
  }

  // Brands
  for (const b of brands) {
    await db.brand.upsert({
      where: { id: b.id }, update: { productCount: b.productCount },
      create: { id: b.id, name: b.name, slug: b.slug, sourceUrl: b.sourceUrl || "", logo: b.logo || "", productCount: b.productCount || 0 },
    });
  }

  // Service add-ons
  for (const s of services) {
    await db.serviceAddOn.upsert({
      where: { id: s.id }, update: {},
      create: { id: s.id, name: s.name, description: s.description || "", price: s.price ?? null, optional: s.optional ?? true, appliesToCategory: s.appliesToCategory || "" },
    });
  }

  // Products
  const catByName = new Map((await db.category.findMany()).map((c: any) => [c.name.toLowerCase(), c.id]));
  let created = 0;
  for (const p of products) {
    const slug = slugOf(p.newSlug);
    const categoryId = catByName.get((p.subcategory || "").toLowerCase()) || catByName.get((p.category || "").toLowerCase()) || null;
    await db.product.upsert({
      where: { slug },
      update: { priceNow: p.priceNow, priceWas: p.priceWas, saving: p.saving, availabilityNormalised: p.availabilityNormalised, lastScrapedAt: new Date(p.scrapedAt || Date.now()) },
      create: {
        sourceUrl: p.sourceUrl, oldUrl: p.oldUrl, slug, title: p.title, brand: p.brand, productCode: p.productCode,
        category: p.category || "", subcategory: p.subcategory || "", breadcrumbs: p.breadcrumbs || [],
        priceNow: p.priceNow ?? null, priceWas: p.priceWas ?? null, saving: p.saving ?? null, currency: p.currency || "GBP",
        availabilityRaw: p.availability || "", availabilityNormalised: p.availabilityNormalised || "call_to_confirm",
        warranty: p.warranty || "", shortDescription: p.shortDescription || "", descriptionHtml: p.descriptionHtml || "", descriptionText: p.descriptionText || "",
        specifications: p.specifications || [], features: p.features || [], energyLabelUrl: p.energyLabelUrl || "",
        mainImage: p.image || "", galleryImages: p.gallery || [], relatedProductCodes: (p.relatedProducts || []).map((r: any) => r.productCode).filter(Boolean),
        serviceAddOns: p.services || [], deliveryNotes: p.deliveryNotes || "", seoTitle: p.seoTitle || "", seoDescription: p.seoDescription || "",
        lastScrapedAt: new Date(p.scrapedAt || Date.now()), adminOverrideFields: [], categoryId,
      },
    });
    created++;
  }

  // Record a scrape job for the admin overview
  await db.scrapeJob.create({
    data: { status: "completed", finishedAt: new Date(), pagesFound: products.length, pagesScraped: products.length, productsFound: products.length, productsCreated: created, errors: [], reportPath: "data/scrape-report.json" },
  });

  const counts = { products: await db.product.count(), categories: await db.category.count(), brands: await db.brand.count(), services: await db.serviceAddOn.count() };
  console.log("Seeded:", counts);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
