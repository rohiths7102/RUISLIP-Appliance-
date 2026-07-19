import productsJson from "@/data/products.json";
import categoriesJson from "@/data/categories.json";
import brandsJson from "@/data/brands.json";
import businessJson from "@/data/business.json";
import servicesJson from "@/data/services.json";
import type { Product, Category, Brand, Business, Service } from "./types";

export const products = productsJson as Product[];
export const categories = categoriesJson as Category[];
export const brands = brandsJson as Brand[];
export const business = businessJson as Business;
export const services = servicesJson as Service[];

/** "/products/bosch-..." -> "bosch-..." */
export const slugOf = (p: Product) => p.newSlug.replace(/^\/products\//, "");
export const getProduct = (slug: string) => products.find((p) => slugOf(p) === slug);
export const getProductByCode = (code: string) =>
  products.find((p) => p.productCode.toLowerCase() === code.toLowerCase());

export const topCategories = () => categories.filter((c) => !c.parentCategory);
export const childCategories = (parentId: string) => categories.filter((c) => c.parentCategory === parentId);
export const getCategory = (slug: string) => categories.find((c) => c.slug.replace(/^\//, "") === slug || c.id === slug);
export const productsInCategory = (name: string) =>
  products.filter((p) => p.category === name || p.subcategory === name);

export const getBrand = (slug: string) => brands.find((b) => b.slug === slug || b.id === slug);
export const productsForBrand = (name: string) =>
  products.filter((p) => p.brand.toLowerCase() === name.toLowerCase());

export const relatedFor = (p: Product, n = 4) =>
  products.filter((x) => x.productCode !== p.productCode && (x.category === p.category || x.brand === p.brand)).slice(0, n);
