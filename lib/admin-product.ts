/** Shared shaping/validation for admin product writes (create + update). */

/** Fields the owner may edit. Anything not listed here is not writable from the admin. */
export const EDITABLE = [
  "title", "brand", "productCode", "category", "subcategory",
  "priceNow", "priceWas", "saving", "availabilityNormalised", "availabilityRaw",
  "warranty", "shortDescription", "descriptionText", "deliveryNotes", "mainImage", "isVisible", "featured",
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
  if (key === "availabilityNormalised") {
    const s = String(v);
    if (!AVAILABILITY.includes(s)) throw new ValidationError(`availability must be one of: ${AVAILABILITY.join(", ")}`);
    return s;
  }
  return typeof v === "string" ? v.trim() : v;
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
