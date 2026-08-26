export type AvailabilityNormalised =
  | "in_stock" | "limited" | "awaiting_stock" | "call_to_confirm" | "unavailable" | "unknown";

export interface Product {
  id: string; sourceUrl: string; oldUrl: string; newSlug: string;
  title: string; brand: string; productCode: string;
  category: string; subcategory: string; breadcrumbs: string[];
  priceNow: number | null; priceWas: number | null; saving: number | null; currency: string;
  availability: string; availabilityNormalised: AvailabilityNormalised;
  warranty: string; shortDescription: string; descriptionHtml: string; descriptionText: string;
  specifications: { label: string; value: string }[]; features: string[];
  energyLabelUrl: string; image: string; gallery: string[];
  relatedProducts: { productCode: string; title: string; url: string; price: number | null }[];
  services: { name: string; price: number | null; optional: boolean }[];
  deliveryNotes: string; seoTitle: string; seoDescription: string;
  meta: Record<string, unknown>; scrapedAt: string;
}
export interface Category {
  id: string; name: string; slug: string; sourceUrl: string; parentCategory: string;
  children: string[]; description: string; productCount: number; image: string;
  seoTitle: string; seoDescription: string;
  /** Owner-set: products here show the call-for-pricing label instead of a price. */
  priceOnApplication?: boolean;
}
export interface Brand {
  id: string; name: string; slug: string; sourceUrl: string; logo: string; productCount: number;
  /** Display rank on /brands — the owner's main brands pin first (low = first). */
  order?: number;
}
export interface Business {
  businessName: string; tradingName: string; phone: string; email: string;
  address: { line1: string; line2: string; county: string; postcode: string; country: string };
  openingHours: Record<string, string>;
  delivery: { radius: string; notes: string; timescale: string };
  socialLinks: { platform: string; url: string }[];
  mapQuery: string; googleMapsEmbedUrl: string; googleMapsDirectionsUrl: string;
  /** Trading disclosures — blank until the owner supplies them; never rendered when empty. */
  companyNumber: string; placeOfRegistration: string; registeredOffice: string; vatNumber: string;
}
export interface Service { id: string; name: string; description: string; price: number | null; optional: boolean; category: string; }
