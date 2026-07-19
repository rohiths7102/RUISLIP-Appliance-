export * from "./normalise.js";
import type { Product } from "./schemas.js";

/** Ensure a scraped partial has every field the DB/frontend expects, with safe defaults. */
export function normaliseProductRecord(p: Partial<Product>): Partial<Product> {
  return {
    currency: "GBP", availabilityNormalised: "call_to_confirm",
    breadcrumbs: [], specifications: [], features: [], gallery: [],
    relatedProducts: [], services: [], meta: {}, ...p,
  };
}
