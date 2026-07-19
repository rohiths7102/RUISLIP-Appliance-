import type { Product, Category, Brand } from "./types";
export const slugOf = (p: Product) => p.newSlug.replace(/^\/products\//, "");
export const getProduct = (ps: Product[], slug: string) => ps.find((p) => slugOf(p) === slug);
export const topCategories = (cs: Category[]) => cs.filter((c) => !c.parentCategory);
export const childCategories = (cs: Category[], parentId: string) => cs.filter((c) => c.parentCategory === parentId);
export const getCategoryById = (cs: Category[], id: string) => cs.find((c) => c.id === id || c.slug.replace(/^\//, "") === id);
export const productsInCategory = (ps: Product[], name: string) => ps.filter((p) => p.category === name || p.subcategory === name);
export const getBrandBySlug = (bs: Brand[], slug: string) => bs.find((b) => b.slug === slug || b.id === slug);
export const productsForBrand = (ps: Product[], name: string) => ps.filter((p) => p.brand.toLowerCase() === name.toLowerCase());
export const relatedFor = (ps: Product[], p: Product, n = 4) =>
  ps.filter((x) => x.productCode !== p.productCode && (x.category === p.category || x.brand === p.brand)).slice(0, n);
