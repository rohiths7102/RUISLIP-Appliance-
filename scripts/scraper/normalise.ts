import slugify from "slugify";
import { CTA_WORDING } from "./config.js";
import type { Product, Redirect } from "./schemas.js";

/** "£1,049.00" | "Was £309.99" -> 1049.00 | 309.99 ; empty/missing -> null */
export function parsePrice(raw?: string | null): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  return m ? Number(m[1]) : null;
}

/** Clean the trailing " test" the source data appends to warranty labels, and tidy whitespace. */
export function cleanWarranty(raw?: string | null): string {
  if (!raw) return "";
  return raw.replace(/\btest\b\s*$/i, "").replace(/\s+/g, " ").trim();
}

export function toSlug(input: string): string {
  return slugify(input, { lower: true, strict: true, trim: true });
}

/** New canonical product slug, e.g. /products/bosch-wan28258gb-8kg-1400-spin-washing-machine-white */
export function newProductSlug(title: string, code: string): string {
  const base = toSlug(title || code);
  const codeSlug = toSlug(code);
  // Ensure the product code is present in the slug for uniqueness + SEO.
  const url = base.includes(codeSlug) || !codeSlug ? base : `${base}-${codeSlug}`;
  return `/products/${url}`;
}

/**
 * Map any source availability text to the normalised enum.
 * Client rule: the store note says most items are in stock but the site tells
 * customers to phone — so anything ambiguous defaults to `call_to_confirm`.
 */
export function normaliseAvailability(raw?: string | null): Product["availabilityNormalised"] {
  const t = (raw || "").toLowerCase();
  if (!t) return "call_to_confirm";
  // The store's model: "not available to buy online" / "call the store" => phone-first
  if (/not available (to buy )?online|in[- ]?store only|call (the )?store|please call|phone (the )?store/.test(t)) return "call_to_confirm";
  if (/(out of stock|no longer available|discontinued|sold out|unavailable)/.test(t)) return "unavailable";
  if (/(awaiting|pre-?order|coming soon|back ?order)/.test(t)) return "awaiting_stock";
  if (/in stock/.test(t)) return "in_stock";
  if (/available/.test(t) && !/not available/.test(t)) return "in_stock";
  if (/(call|phone|enquire|contact)/.test(t)) return "call_to_confirm";
  return "call_to_confirm";
}

/** Customer-facing availability label for the new (phone-first) UI. */
export function availabilityLabel(n: Product["availabilityNormalised"]): string {
  switch (n) {
    case "in_stock": return "In stock — call to confirm";
    case "awaiting_stock": return "Awaiting stock — call to confirm availability";
    case "unavailable": return "Currently unavailable — call the store";
    case "call_to_confirm": return "Call to confirm availability";
    default: return "Call to confirm availability";
  }
}

/** Replace any legacy ecommerce wording with phone-first wording. */
export function convertWording(text?: string | null): string {
  let out = text || "";
  for (const [oldW, newW] of Object.entries(CTA_WORDING)) {
    out = out.replace(new RegExp(oldW, "gi"), newW);
  }
  return out;
}

/** Guard used by validateData: no legacy buying language may survive into the frontend. */
export function containsBuyingLanguage(text?: string | null): boolean {
  return /\b(buy now|add to basket|add to cart|checkout|proceed to pay)\b/i.test(text || "");
}

/** Link related products to full product records by product code where possible. */
export function linkRelatedByCode(products: Product[]): Product[] {
  const byCode = new Map(products.map((p) => [p.productCode.toUpperCase(), p]));
  for (const p of products) {
    p.relatedProducts = (p.relatedProducts || []).map((r) => {
      const match = r.productCode ? byCode.get(r.productCode.toUpperCase()) : undefined;
      return match
        ? { productCode: match.productCode, title: match.title, url: match.newSlug, price: match.priceNow }
        : r;
    });
  }
  return products;
}

export function makeRedirect(oldUrl: string, newUrl: string, type: string): Redirect {
  return { oldUrl, newUrl, type, status: 301 };
}
