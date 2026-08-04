import type { AvailabilityNormalised } from "./types";

/** Canonical price formatter — whole pounds drop the ".00" (£1,299), real pence keep it (£123.45). */
export const formatPrice = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency", currency: "GBP",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);

/** Unpriced items: a label, not a number — callers style it distinctly from real prices. */
// The owner's own words ("just call to ask", "call for price in this section").
export const PRICE_ON_APPLICATION = "Call for price";

export const gbp = (n: number | null) =>
  n === null || Number.isNaN(n) ? "Call for price" : formatPrice(n);

/**
 * Phone-first wording. These states come from the manufacturer's own catalogue,
 * not from the shop's till, so nothing here ever states stock as fact — every
 * label still sends the customer to the phone.
 */
export const availabilityLabel = (a: AvailabilityNormalised): string => {
  switch (a) {
    case "in_stock": return "In stock — call to confirm";
    case "limited": return "Limited availability — call to confirm";
    case "awaiting_stock": return "Awaiting stock — call to confirm";
    case "unavailable": return "Currently unavailable — call the store";
    default: return "Call to confirm availability";
  }
};

export const availabilityDot = (a: AvailabilityNormalised): string => {
  switch (a) {
    case "in_stock": return "#3f8f5b";
    case "limited": return "#b5651d";
    case "awaiting_stock": return "#c98a2e";
    case "unavailable": return "#9a3b1d";
    default: return "#9a8252";
  }
};

/** Phone-first: build tel: href from a display phone. */
export const telHref = (phone: string) => "tel:" + phone.replace(/[^0-9+]/g, "");

export const STORE_PHONE = "0208 864 5763";
