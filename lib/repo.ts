/**
 * Server-side data access. Reads from the Prisma database when it's available
 * and initialised; otherwise falls back to the bundled JSON seed. This makes the
 * site resilient (works before `prisma generate`/`db:seed`) and lets it build in
 * environments without a live DB. The database is the source of truth in production.
 */
import { cache } from "react";
import * as seed from "./data";
import type { Product, Category, Brand, Business, Service } from "./types";

import { getPrisma } from "./prisma";

/**
 * Resolve the database, or null to fall back to the bundled JSON catalogue.
 *
 * Two failure modes this has to avoid, both of which silently serve a STALE
 * catalogue (hiding every admin edit) rather than erroring:
 *
 *  1. Caching a failed probe forever — the DB may come up after the server does
 *     (first migrate/import), so a failure is only remembered briefly.
 *  2. Returning null to callers that race an in-flight probe. Concurrent requests
 *     at startup must await the SAME probe, not be told "no database".
 */
const PROBE_RETRY_MS = 10_000;
let _db: any = null;
let _probe: Promise<any> | null = null;
let _failedAt = 0;

async function getDb(): Promise<any> {
  if (_db) return _db;
  if (_probe) return _probe; // a probe is in flight — wait for it, don't fall back
  if (Date.now() - _failedAt < PROBE_RETRY_MS) return null; // recently down; don't hammer it
  _probe = (async () => {
    try {
      const client = await getPrisma(); // shared singleton — don't open a second pool
      await client.$queryRaw`SELECT 1`; // throws if engine/db unavailable
      _db = client;
      return client;
    } catch {
      _failedAt = Date.now();
      _db = null;
      return null;
    } finally {
      _probe = null;
    }
  })();
  return _probe;
}

const arr = (v: any): any[] => (Array.isArray(v) ? v : typeof v === "string" ? safe(v) : []);
const safe = (s: string) => { try { const x = JSON.parse(s); return Array.isArray(x) ? x : []; } catch { return []; } };

function mapProduct(r: any): Product {
  return {
    id: r.id, sourceUrl: r.sourceUrl, oldUrl: r.oldUrl, newSlug: `/products/${r.slug}`,
    title: r.title, brand: r.brand, productCode: r.productCode, category: r.category, subcategory: r.subcategory,
    breadcrumbs: arr(r.breadcrumbs), priceNow: r.priceNow, priceWas: r.priceWas, saving: r.saving, currency: r.currency,
    availability: r.availabilityRaw, availabilityNormalised: r.availabilityNormalised, warranty: r.warranty,
    shortDescription: r.shortDescription, descriptionHtml: r.descriptionHtml, descriptionText: r.descriptionText,
    specifications: arr(r.specifications), features: arr(r.features), energyLabelUrl: r.energyLabelUrl,
    image: r.mainImage, gallery: arr(r.galleryImages),
    relatedProducts: arr(r.relatedProductCodes).map((c: string) => ({ productCode: c, title: "", url: "", price: null })),
    services: arr(r.serviceAddOns), deliveryNotes: r.deliveryNotes, seoTitle: r.seoTitle, seoDescription: r.seoDescription,
    meta: {}, scrapedAt: r.lastScrapedAt ? String(r.lastScrapedAt) : "",
  };
}
function mapBusiness(biz: any): Business {
  return {
    businessName: biz.businessName, tradingName: biz.tradingName, phone: biz.phone, email: biz.email,
    address: biz.address, openingHours: biz.openingHours,
    delivery: { radius: biz.deliveryRadius, notes: biz.deliveryNotes, timescale: "" },
    socialLinks: biz.socialLinks, mapQuery: biz.mapQuery, googleMapsEmbedUrl: biz.googleMapsEmbedUrl, googleMapsDirectionsUrl: biz.googleMapsDirectionsUrl,
    companyNumber: biz.companyNumber || "", placeOfRegistration: biz.placeOfRegistration || "",
    registeredOffice: biz.registeredOffice || "", vatNumber: biz.vatNumber || "",
  };
}
function mapCategory(r: any): Category {
  return { id: r.id, name: r.name, slug: r.slug, sourceUrl: r.sourceUrl, parentCategory: r.parentId || "",
    children: [], description: r.description, productCount: r.productCount, image: r.image, seoTitle: r.seoTitle, seoDescription: r.seoDescription,
    priceOnApplication: !!r.priceOnApplication };
}

export interface Catalog { products: Product[]; categories: Category[]; brands: Brand[]; business: Business; services: Service[]; source: "database" | "seed"; }

async function readCatalog(): Promise<Catalog> {
  const fallback: Catalog = { products: seed.products, categories: seed.categories, brands: seed.brands, business: seed.business, services: seed.services, source: "seed" };
  const db = await getDb();
  if (!db) return fallback;
  try {
    const [prod, cats, brds, biz, svcs] = await Promise.all([
      db.product.findMany({ where: { isVisible: true }, orderBy: { title: "asc" } }),
      db.category.findMany({ where: { isVisible: true } }),
      // Owner's main brands pin first (order asc), then alphabetical.
      db.brand.findMany({ where: { isVisible: true }, orderBy: [{ order: "asc" }, { name: "asc" }] }),
      db.businessInfo.findUnique({ where: { id: "business" } }), db.serviceAddOn.findMany(),
    ]);
    if (!prod.length) return fallback;
    const business: Business = biz ? mapBusiness(biz) : seed.business;
    return {
      products: prod.map(mapProduct), categories: cats.map(mapCategory),
      brands: brds.map((b: any) => ({ id: b.id, name: b.name, slug: b.slug, sourceUrl: b.sourceUrl, logo: b.logo, productCount: b.productCount })),
      business, services: svcs.map((s: any) => ({ id: s.id, name: s.name, description: s.description, price: s.price, optional: s.optional, category: s.appliesToCategory || "delivery" })),
      source: "database",
    };
  } catch {
    return fallback;
  }
}
/**
 * Request-scoped memoisation. generateMetadata, the root layout and the page
 * body all render in ONE React pass, so a product page pulled the whole
 * catalogue three or four times per render — at ~13 MB a pull that alone put
 * the free database tier's monthly egress inside a day of modest traffic, and
 * it is most of why a cold product page took 3–6 seconds ("pages don't open").
 * React's cache() collapses those to one read and dies with the request:
 * nothing persists between requests, so an admin edit still shows on the very
 * next render and a seed-fallback result can never be frozen in. Outside a
 * React render (route handlers, scripts) it is a pass-through.
 */
export const loadCatalog = cache(readCatalog);

/** The one business row, without dragging 5,000 products along for the ride. */
export const getBusiness = cache(async (): Promise<Business> => {
  const db = await getDb();
  if (!db) return seed.business;
  try {
    const biz = await db.businessInfo.findUnique({ where: { id: "business" } });
    return biz ? mapBusiness(biz) : seed.business;
  } catch {
    return seed.business;
  }
});

/** What the root layout actually needs: nav categories, nav brands, business.
 *  ~9 KB instead of the full catalogue on every render of every page. The
 *  explicit shape keeps the seed-fallback branches (full Category/Brand rows)
 *  and the narrow db projection converging on one type. */
export type NavCategory = { id: string; name: string; parentCategory: string; image: string; productCount: number };
export type NavBrand = { name: string; slug: string; productCount: number };
export const getNav = cache(async (): Promise<{ business: Business; categories: NavCategory[]; brands: NavBrand[] }> => {
  const db = await getDb();
  if (!db) {
    return { business: seed.business, categories: seed.categories, brands: seed.brands };
  }
  try {
    const [cats, brds, business] = await Promise.all([
      db.category.findMany({ where: { isVisible: true }, select: { id: true, name: true, parentId: true, image: true, productCount: true } }),
      db.brand.findMany({ where: { isVisible: true }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { name: true, slug: true, productCount: true } }),
      getBusiness(),
    ]);
    if (!cats.length) return { business, categories: seed.categories, brands: seed.brands };
    return {
      business,
      categories: cats.map((c: any) => ({ id: c.id, name: c.name, parentCategory: c.parentId || "", image: c.image || "", productCount: c.productCount })),
      brands: brds.map((b: any) => ({ name: b.name, slug: b.slug, productCount: b.productCount })),
    };
  } catch {
    return { business: seed.business, categories: seed.categories, brands: seed.brands };
  }
});
