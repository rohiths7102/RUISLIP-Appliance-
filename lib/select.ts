import type { Product, Category, Brand } from "./types";
import { energyClassOf } from "./energy";
export const slugOf = (p: Product) => p.newSlug.replace(/^\/products\//, "");
/**
 * Card-only DTO for grid routes — descriptionHtml/specs/features are ~90% of the
 * serialised RSC payload and the browser grid never reads them. energyClass is
 * pre-computed here so ProductBrowser can build its filter row and chips without
 * shipping the specs array to the client.
 */
export const toCardItem = (p: Product, poaNames?: Set<string>) => {
  // Owner-flagged "call for price" categories (accessories at cost price, coffee
  // machines) — the card shows no price at all, per the owner's instruction.
  // The numbers are nulled, not just hidden: a price the owner doesn't publish
  // must not ride along in the RSC payload where View Source would reveal it
  // (it would also silently drive the price sort).
  const poa = !!poaNames && (poaNames.has(p.category) || poaNames.has(p.subcategory));
  return {
    id: p.id, newSlug: p.newSlug, title: p.title, brand: p.brand, productCode: p.productCode,
    category: p.category, subcategory: p.subcategory, image: p.image,
    priceNow: poa ? null : p.priceNow, priceWas: poa ? null : p.priceWas, saving: poa ? null : p.saving,
    availability: p.availability, availabilityNormalised: p.availabilityNormalised,
    energyClass: energyClassOf(p.specifications),
    poa,
  };
};

/**
 * Names of every category the owner flagged price-on-application.
 *
 * Two situations look alike in the data and need OPPOSITE answers:
 *
 *  1. The owner deliberately unticked a category's flag. That is a real
 *     instruction and must win — otherwise the admin checkbox is a lie the
 *     owner has no way to undo from the admin.
 *  2. The flag never reached us: the category is hidden (loadCatalog fetches
 *     isVisible categories only), deleted, or the catalogue is a pre-flag seed
 *     snapshot. There is no instruction here, and a degraded catalogue must
 *     never resurrect prices the owner withholds.
 *
 * PRESENCE in the catalogue is what tells them apart. A fallback category that
 * IS in `cs` and carries no flag is case 1, so the owner's data stands alone.
 * One that is absent is case 2, so the fallback still masks it — hiding a
 * flagged category must not un-hide its prices on every storefront surface.
 * An empty `cs` (no flag information at all) therefore masks the whole set.
 */
const POA_FALLBACK = [
  "Accessories & Spare Parts", "Coffee Machines", "Oven & Cooking Accessories",
  "Hob Accessories", "Hood Filters & Accessories", "Laundry Accessories",
  "Refrigeration Accessories", "Dishwasher Accessories", "Vacuum Bags & Accessories",
  "Coffee Machine Accessories", "Kitchen Machine Accessories", "Kitchen Utensils",
  "Cleaning & Care Products", "Spare Parts",
];
export const poaNamesFrom = (cs: Pick<Category, "name" | "priceOnApplication">[]) => {
  const known = new Set(cs.map((c) => c.name));
  return new Set([
    ...cs.filter((c) => c.priceOnApplication).map((c) => c.name),
    ...POA_FALLBACK.filter((n) => !known.has(n)),
  ]);
};
export const getProduct = (ps: Product[], slug: string) => ps.find((p) => slugOf(p) === slug);
export const topCategories = <T extends { parentCategory: string }>(cs: T[]) => cs.filter((c) => !c.parentCategory);
export const childCategories = <T extends { parentCategory: string }>(cs: T[], parentId: string) => cs.filter((c) => c.parentCategory === parentId);
export const getCategoryById = (cs: Category[], id: string) => cs.find((c) => c.id === id || c.slug.replace(/^\//, "") === id);
export const productsInCategory = (ps: Product[], name: string) => ps.filter((p) => p.category === name || p.subcategory === name);
export const getBrandBySlug = (bs: Brand[], slug: string) => bs.find((b) => b.slug === slug || b.id === slug);
export const productsForBrand = (ps: Product[], name: string) => ps.filter((p) => p.brand.toLowerCase() === name.toLowerCase());
/**
 * Related products, scored — not "first four in array order", which showed every
 * Cooking customer the same set of spare parts next to a £1,099 oven.
 * Same subcategory beats same category; photographed beats unphotographed; a
 * price within ±40% beats a wild mismatch. Accessories never accompany real
 * appliances (test strips are not an upsell), and a per-product hash tiebreak
 * gives each page a distinct-but-stable set.
 */
export const relatedFor = (ps: Product[], p: Product, n = 4) => {
  const ACCESSORIES = "Accessories & Spare Parts";
  const srcIsAccessory = p.category === ACCESSORIES;
  const seed = [...p.productCode].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return ps
    .filter((x) =>
      x.productCode !== p.productCode &&
      (srcIsAccessory || x.category !== ACCESSORIES) &&
      (x.subcategory === p.subcategory || x.category === p.category || x.brand === p.brand))
    .map((x) => {
      let s = 0;
      if (x.subcategory && x.subcategory === p.subcategory) s += 3;
      else if (x.category === p.category) s += 1;
      if (x.image) s += 1;
      if (p.priceNow && x.priceNow && Math.abs(x.priceNow - p.priceNow) / p.priceNow <= 0.4) s += 2;
      // stable per-source-product shuffle so pages differ without churning on reload
      const jitter = ((seed ^ [...x.productCode].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5)) % 1000) / 1000;
      return { x, s: s + jitter };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((r) => r.x);
};
