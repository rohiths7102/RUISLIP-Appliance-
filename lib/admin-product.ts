/** Shared shaping/validation for admin product writes (create + update). */
import { normaliseWarranty } from "@/lib/warranty";

/** Fields the owner may edit. Anything not listed here is not writable from the admin. */
export const EDITABLE = [
  "title", "brand", "productCode", "category", "subcategory",
  "priceNow", "priceWas", "saving", "availabilityNormalised", "availabilityRaw",
  "warranty", "shortDescription", "descriptionText", "deliveryNotes", "mainImage", "isVisible", "featured",
  "seoTitle", "seoDescription",
] as const;

/** Fields a re-scrape owns — once the owner edits one, it gets locked. */
export const SCRAPE_OWNED = new Set<string>([
  "title", "priceNow", "priceWas", "saving", "availabilityNormalised",
  "availabilityRaw", "warranty", "shortDescription", "deliveryNotes", "mainImage",
]);

const NUM = new Set(["priceNow", "priceWas", "saving"]);
const BOOL = new Set(["isVisible", "featured"]);

export const AVAILABILITY = ["in_stock", "limited", "awaiting_stock", "call_to_confirm", "unavailable", "unknown"];

export class ValidationError extends Error {}

/**
 * Coerce one incoming field. Rejects NaN rather than persisting it — `Number("12,50")`
 * is NaN, and a NaN price silently becomes "no price" on the storefront.
 */
export function coerce(key: string, v: any): any {
  if (NUM.has(key)) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new ValidationError(`${key} must be a number`);
    if (n < 0) throw new ValidationError(`${key} cannot be negative`);
    return n;
  }
  if (BOOL.has(key)) return Boolean(v);
  if (key === "warranty") return normaliseWarranty(String(v ?? ""));
  if (key === "mainImage") {
    const s = String(v ?? "").trim();
    // Google and the storefront need a full https:// address (or our own /path);
    // "www.x.com/a.jpg" or http:// breaks the photo on every surface.
    if (s && !/^https:\/\//.test(s) && !s.startsWith("/")) throw new ValidationError("Image link must start with https://");
    return s;
  }
  if (key === "availabilityNormalised") {
    const s = String(v);
    if (!AVAILABILITY.includes(s)) throw new ValidationError(`availability must be one of: ${AVAILABILITY.join(", ")}`);
    return s;
  }
  return typeof v === "string" ? v.trim() : v;
}

type Cat = { id: string; name: string; parentId: string | null };
export const loadCategories = (db: any): Promise<Cat[]> =>
  db.category.findMany({ select: { id: true, name: true, parentId: true } });

/**
 * A product must sit in a real department AND one of its sub-categories:
 * department pages and search match on these exact names, so Zenith ZE501
 * saved as "Cooking" with no sub-category (26 Sept 2026) was on no page and in
 * no "cookers" search. Returns both names in their stored spelling.
 */
export function checkTaxonomy(cats: Cat[], category: string, subcategory: string) {
  const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const top = cats.find((c) => !c.parentId && eq(c.name, category || ""));
  if (!top) throw new ValidationError(category ? `"${category}" is not a department — pick one from the list` : "Pick a department");
  const kids = cats.filter((c) => c.parentId === top.id);
  if (!kids.length) return { category: top.name, subcategory: "" };
  const leaf = kids.find((c) => eq(c.name, subcategory || ""));
  if (!leaf) throw new ValidationError(subcategory
    ? `"${subcategory}" is not a sub-category of ${top.name}`
    : `Pick a sub-category of ${top.name} — without one the product shows on no department page`);
  return { category: top.name, subcategory: leaf.name };
}

/** Same code + same brand is the same appliance (Bosch/Neff twins share codes legitimately). */
export async function findDuplicate(db: any, productCode: string, brand: string, exceptId?: string) {
  const rows: { id: string; title: string; productCode: string; brand: string }[] =
    await db.product.findMany({ select: { id: true, title: true, productCode: true, brand: true } });
  const k = (s: string) => (s || "").trim().toUpperCase();
  return rows.find((p) => p.id !== exceptId && k(p.productCode) === k(productCode) && k(p.brand) === k(brand)) || null;
}

export const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** Keep priceWas/saving coherent so the storefront can't show "Save £-40". */
export function reconcileSaving(data: Record<string, any>, existing: Record<string, any> = {}) {
  const now = data.priceNow !== undefined ? data.priceNow : existing.priceNow;
  const was = data.priceWas !== undefined ? data.priceWas : existing.priceWas;
  if (typeof now === "number" && typeof was === "number" && was > now) data.saving = Math.round((was - now) * 100) / 100;
  else if ("priceWas" in data || "priceNow" in data) data.saving = null;
  return data;
}
