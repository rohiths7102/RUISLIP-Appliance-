/**
 * The owner's homepage choices: the hero slideshow and the featured-products
 * row, edited in Admin → Homepage and stored on BusinessInfo.homepage.
 *
 * Until he saves anything the column is null and the homepage is exactly what
 * it was before this became editable: the eight slides that were written into
 * app/page.tsx, and the featured row synced from his Euronics storefront
 * (data/featured-products.json).
 *
 * The featured list is the ONE source of truth for that row. Product.featured
 * is kept as a mirror of it, so the "Featured" tick-box on a product and the
 * bulk "Feature" button stay truthful — they add to and remove from this list.
 */
import featuredSync from "@/data/featured-products.json";
import { writeAudit } from "@/lib/audit";

export type HomeSlide = {
  id: string;
  enabled: boolean;
  /** A brand name, or "" for the shop's own Euronics slide. */
  brand: string;
  line: string;
  sub: string;
  /** Up to three model codes: the lead product first. */
  codes: string[];
};
export type HomeFeatured = { code: string; bestSeller: boolean };
export type Homepage = { slides: HomeSlide[]; featured: HomeFeatured[] };

/** How many featured products the homepage row shows. */
export const FEATURED_SHOWN = 12;
const MAX_SLIDES = 12;
const MAX_FEATURED = 40;

export const DEFAULT_SLIDES: HomeSlide[] = [
  { id: "shop", enabled: true, brand: "", codes: ["RF605QNUVX1", "SMS6ZCI10G", "WRB247C9GB"],
    line: "Top brand, hand-picked appliances",
    sub: "Professionally fitted (optional), and delivered within a day or two if it is in stock locally." },
  { id: "bosch", enabled: true, brand: "Bosch", codes: ["KFD96APEA", "WGH254A0GB", "SMS6TCI02G"], line: "The Bosch range",
    sub: "Series 4, 6 and 8 across the kitchen — delivered in our own van and fitted by our own team." },
  { id: "neff", enabled: true, brand: "Neff", codes: ["C24MT73G0B", "U2ACH7AG7B", "V8540X0GB"], line: "The Neff range",
    sub: "Slide&Hide ovens and CircoTherm, built for the kitchen you’ve planned. Installed and tested by us." },
  { id: "blomberg", enabled: true, brand: "Blomberg", codes: ["KFD4953XD", "FND479P", "LWA18461W"], line: "The Blomberg range",
    sub: "Three-year guarantee as standard, across cooling, cooking and laundry." },
  { id: "miele", enabled: true, brand: "Miele", codes: ["WEE385WCS", "WEG885 WCS", "G5611SC"], line: "The Miele range",
    sub: "Made to last twenty years. Delivered, fitted, and the old one taken away." },
  { id: "samsung", enabled: true, brand: "Samsung", codes: ["WF90F09C4SU1", "RS90F66BETEU", "WW11DB8B95GBU1"], line: "The Samsung range",
    sub: "Televisions, fridge freezers and laundry, delivered locally by our own team." },
  { id: "beko", enabled: true, brand: "Beko", codes: ["HIXI84700UP", "EDG6231W", "CNG4692VW"], line: "The Beko range",
    sub: "The everyday range, priced keenly and fitted by our own team." },
  { id: "hisense", enabled: true, brand: "Hisense", codes: ["RF749N4SWSE", "RF815N4SESE", "RQ5P470SYFD"], line: "The Hisense range",
    sub: "Big-screen televisions and American fridge freezers, delivered locally." },
];

const DEFAULT_FEATURED: HomeFeatured[] = featuredSync.items.map((i: { code: string; bestSeller?: boolean }) => ({ code: i.code, bestSeller: !!i.bestSeller }));

export class HomepageError extends Error {}

const str = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Anything stored or submitted -> a clean Homepage. Missing sections fall back
 * to the defaults; `strict` (a save) refuses what it cannot use instead.
 */
export function toHomepage(raw: any, strict = false): Homepage {
  const fail = (m: string) => { if (strict) throw new HomepageError(m); };
  let slides = DEFAULT_SLIDES;
  if (Array.isArray(raw?.slides)) {
    if (raw.slides.length > MAX_SLIDES) fail(`At most ${MAX_SLIDES} slides.`);
    slides = raw.slides.slice(0, MAX_SLIDES).map((s: any, i: number) => {
      const codes = (Array.isArray(s?.codes) ? s.codes : []).map((c: unknown) => str(c, 40)).filter(Boolean).slice(0, 3);
      if (!codes.length) fail(`Slide ${i + 1} needs at least one product.`);
      return { id: str(s?.id, 40) || `slide-${i + 1}`, enabled: s?.enabled !== false, brand: str(s?.brand, 60),
        line: str(s?.line, 80) || (s?.brand ? `The ${str(s.brand, 60)} range` : "Top brand, hand-picked appliances"),
        sub: str(s?.sub, 220), codes };
    }).filter((s: HomeSlide) => s.codes.length);
  }
  let featured = DEFAULT_FEATURED;
  if (Array.isArray(raw?.featured)) {
    if (raw.featured.length > MAX_FEATURED) fail(`At most ${MAX_FEATURED} featured products.`);
    const seen = new Set<string>();
    featured = raw.featured.slice(0, MAX_FEATURED).map((f: any) => ({ code: str(f?.code, 40), bestSeller: !!f?.bestSeller }))
      .filter((f: HomeFeatured) => f.code && !seen.has(f.code.toUpperCase()) && seen.add(f.code.toUpperCase()));
  }
  return { slides, featured };
}

/** The homepage settings. Never throws: a missing column or row means defaults. */
export async function getHomepage(db: any): Promise<Homepage> {
  const row = await db.businessInfo.findUnique({ where: { id: "business" }, select: { homepage: true } }).catch(() => null);
  return toHomepage(row?.homepage);
}

/** Save, and keep Product.featured mirroring the featured list. */
export async function saveHomepage(db: any, raw: unknown, changedBy: string): Promise<Homepage> {
  const next = toHomepage(raw, true);
  const before = await getHomepage(db);
  await db.businessInfo.update({ where: { id: "business" }, data: { homepage: next } });
  const codes = next.featured.map((f) => f.code);
  await db.product.updateMany({ where: { featured: true, productCode: { notIn: codes } }, data: { featured: false } });
  if (codes.length) await db.product.updateMany({ where: { productCode: { in: codes } }, data: { featured: true } });
  await writeAudit(db, {
    entityType: "homepage", entityId: "business", action: "homepage:save", changedFields: ["homepage"],
    previousValue: { slides: before.slides.length, featured: before.featured.map((f) => f.code) },
    newValue: { slides: next.slides.map((s) => `${s.enabled ? "" : "(off) "}${s.brand || "shop"}`), featured: codes },
    changedBy,
  });
  return next;
}

/** The product tick-box and bulk "Feature": add to the end of the row, or take off it. */
export async function setFeatured(db: any, codes: string[], on: boolean, changedBy: string): Promise<void> {
  const h = await getHomepage(db);
  const key = (c: string) => c.toUpperCase();
  const listed = new Set(h.featured.map((f) => key(f.code)));
  const featured = on
    ? [...h.featured, ...codes.filter((c) => !listed.has(key(c))).map((code) => ({ code, bestSeller: false }))]
    : h.featured.filter((f) => !codes.some((c) => key(c) === key(f.code)));
  await saveHomepage(db, { ...h, featured: featured.slice(0, MAX_FEATURED) }, changedBy);
}
