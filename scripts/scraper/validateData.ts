import fs from "fs-extra";
import path from "node:path";
import { OUT } from "./config.js";
import {
  ProductSchema, CategorySchema, BrandSchema, BusinessSchema, type Product, type Category,
} from "./schemas.js";
import { containsBuyingLanguage } from "./normalise.js";

export interface ValidationResult { ok: boolean; errors: string[]; warnings: string[]; }

export async function validateData(dataDir = OUT.data): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const read = async <T>(f: string, fallback: T): Promise<T> =>
    (await fs.pathExists(path.join(dataDir, f))) ? fs.readJson(path.join(dataDir, f)) : fallback;

  const products = await read<Product[]>("products.json", []);
  const categories = await read<Category[]>("categories.json", []);
  const brands = await read<any[]>("brands.json", []);
  const business = await read<any>("business.json", null);

  // Schema validation
  products.forEach((p, i) => {
    const r = ProductSchema.safeParse(p);
    if (!r.success) errors.push(`products[${i}] (${p?.productCode || p?.sourceUrl}): ${r.error.issues.map((x) => x.path.join(".") + " " + x.message).join("; ")}`);
  });
  categories.forEach((c, i) => { if (!CategorySchema.safeParse(c).success) warnings.push(`categories[${i}] failed schema`); });
  brands.forEach((b, i) => { if (!BrandSchema.safeParse(b).success) warnings.push(`brands[${i}] failed schema`); });
  if (business && !BusinessSchema.safeParse(business).success) errors.push("business.json failed schema");

  // Required fields
  for (const p of products) {
    if (!p.title) errors.push(`Missing title: ${p.sourceUrl}`);
    if (!p.productCode) errors.push(`Missing productCode: ${p.sourceUrl}`);
    if (!p.sourceUrl) errors.push(`Missing sourceUrl for "${p.title}"`);
    if (!p.newSlug) errors.push(`Missing newSlug: ${p.productCode}`);
    for (const field of ["priceNow", "priceWas", "saving"] as const) {
      if (p[field] !== null && typeof p[field] !== "number") errors.push(`${field} not number|null: ${p.productCode}`);
    }
    if (containsBuyingLanguage(`${p.title} ${p.shortDescription} ${p.descriptionText}`))
      errors.push(`Legacy buying language present: ${p.productCode}`);
    if (p.priceNow === null) warnings.push(`Missing price (will show "Call to confirm"): ${p.productCode}`);
    if (!p.image) warnings.push(`Missing image: ${p.productCode}`);
    if (p.availabilityNormalised === "unknown") warnings.push(`Unknown availability -> should be call_to_confirm: ${p.productCode}`);
  }

  // Duplicate product codes
  const byCode = new Map<string, number>();
  products.forEach((p) => byCode.set(p.productCode, (byCode.get(p.productCode) || 0) + 1));
  [...byCode.entries()].filter(([, n]) => n > 1).forEach(([c, n]) => errors.push(`Duplicate productCode "${c}" x${n}`));

  // Broken related products
  const codes = new Set(products.map((p) => p.productCode.toUpperCase()));
  for (const p of products)
    for (const r of p.relatedProducts)
      if (r.productCode && !codes.has(r.productCode.toUpperCase()))
        warnings.push(`Broken related "${r.productCode}" on ${p.productCode}`);

  // Empty categories
  const counts = new Map<string, number>();
  products.forEach((p) => { const k = (p.category || "").toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1); });
  categories.filter((c) => (counts.get(c.name.toLowerCase()) || c.productCount || 0) === 0)
    .forEach((c) => warnings.push(`Empty category: ${c.name}`));

  const ok = errors.length === 0;
  return { ok, errors, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = await validateData();
  console.log(`\nValidation: ${res.ok ? "PASS" : "FAIL"}`);
  if (res.errors.length) console.log("\nErrors:\n - " + res.errors.join("\n - "));
  if (res.warnings.length) console.log(`\nWarnings (${res.warnings.length}):\n - ` + res.warnings.slice(0, 40).join("\n - "));
  process.exit(res.ok ? 0 : 1);
}
