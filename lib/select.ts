import type { Product, Category, Brand } from "./types";
import { energyClassOf } from "./energy";
export const slugOf = (p: Product) => p.newSlug.replace(/^\/products\//, "");
/**
 * Card-only DTO for grid routes — descriptionHtml/specs/features are ~90% of the
 * serialised RSC payload and the browser grid never reads them. energyClass is
 * pre-computed here so ProductBrowser can build its filter row and chips without
 * shipping the specs array to the client.
 */
export const toCardItem = (p: Product) => ({
  id: p.id, newSlug: p.newSlug, title: p.title, brand: p.brand, productCode: p.productCode,
  category: p.category, subcategory: p.subcategory, image: p.image,
  priceNow: p.priceNow, priceWas: p.priceWas, saving: p.saving,
  availability: p.availability, availabilityNormalised: p.availabilityNormalised,
  energyClass: energyClassOf(p.specifications),
});
export const getProduct = (ps: Product[], slug: string) => ps.find((p) => slugOf(p) === slug);
export const topCategories = (cs: Category[]) => cs.filter((c) => !c.parentCategory);
export const childCategories = (cs: Category[], parentId: string) => cs.filter((c) => c.parentCategory === parentId);
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
