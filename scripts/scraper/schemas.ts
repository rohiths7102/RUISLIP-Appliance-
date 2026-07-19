import { z } from "zod";

export const AvailabilityNormalised = z.enum([
  "in_stock",
  "awaiting_stock",
  "call_to_confirm",
  "unavailable",
  "unknown",
]);

export const SpecificationSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const RelatedProductSchema = z.object({
  productCode: z.string().default(""),
  title: z.string().default(""),
  url: z.string().default(""),
  price: z.number().nullable().default(null),
});

export const ServiceRefSchema = z.object({
  name: z.string(),
  price: z.number().nullable().default(null),
  optional: z.boolean().default(true),
});

export const ProductSchema = z.object({
  id: z.string().min(1),
  sourceUrl: z.string().url(),
  oldUrl: z.string(),
  newSlug: z.string().min(1),
  title: z.string().min(1),
  brand: z.string().default(""),
  productCode: z.string().min(1),
  category: z.string().default(""),
  subcategory: z.string().default(""),
  breadcrumbs: z.array(z.string()).default([]),
  priceNow: z.number().nullable().default(null),
  priceWas: z.number().nullable().default(null),
  saving: z.number().nullable().default(null),
  currency: z.string().default("GBP"),
  availability: z.string().default(""),
  availabilityNormalised: AvailabilityNormalised.default("call_to_confirm"),
  warranty: z.string().default(""),
  shortDescription: z.string().default(""),
  descriptionHtml: z.string().default(""),
  descriptionText: z.string().default(""),
  specifications: z.array(SpecificationSchema).default([]),
  features: z.array(z.string()).default([]),
  energyLabelUrl: z.string().default(""),
  image: z.string().default(""),
  gallery: z.array(z.string()).default([]),
  relatedProducts: z.array(RelatedProductSchema).default([]),
  services: z.array(ServiceRefSchema).default([]),
  deliveryNotes: z.string().default(""),
  seoTitle: z.string().default(""),
  seoDescription: z.string().default(""),
  meta: z.record(z.string(), z.any()).default({}),
  scrapedAt: z.string(),
});
export type Product = z.infer<typeof ProductSchema>;

export const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  sourceUrl: z.string(),
  parentCategory: z.string().default(""),
  children: z.array(z.string()).default([]),
  description: z.string().default(""),
  productCount: z.number().default(0),
  image: z.string().default(""),
  seoTitle: z.string().default(""),
  seoDescription: z.string().default(""),
});
export type Category = z.infer<typeof CategorySchema>;

export const BrandSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  sourceUrl: z.string(),
  logo: z.string().default(""),
  productCount: z.number().default(0),
});
export type Brand = z.infer<typeof BrandSchema>;

export const PageSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string().default(""),
  oldUrl: z.string(),
  newSlug: z.string().default(""),
  sourceUrl: z.string(),
  headings: z.array(z.string()).default([]),
  contentHtml: z.string().default(""),
  contentText: z.string().default(""),
  seoTitle: z.string().default(""),
  seoDescription: z.string().default(""),
  scrapedAt: z.string(),
});
export type Page = z.infer<typeof PageSchema>;

export const ServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  price: z.number().nullable().default(null),
  optional: z.boolean().default(true),
  category: z.string().default("delivery"),
});
export type Service = z.infer<typeof ServiceSchema>;

export const NavigationItemSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    label: z.string(),
    url: z.string(),
    newSlug: z.string().default(""),
    children: z.array(NavigationItemSchema).default([]),
  })
);

export const BusinessSchema = z.object({
  businessName: z.string(),
  tradingName: z.string().default(""),
  phone: z.string(),
  email: z.string().default(""),
  address: z.object({
    line1: z.string().default(""),
    line2: z.string().default(""),
    county: z.string().default(""),
    postcode: z.string().default(""),
    country: z.string().default("United Kingdom"),
  }),
  openingHours: z.record(z.string(), z.string()),
  delivery: z.object({
    radius: z.string().default(""),
    notes: z.string().default(""),
    timescale: z.string().default(""),
  }),
  socialLinks: z.array(z.object({ platform: z.string(), url: z.string() })).default([]),
  mapQuery: z.string().default(""),
  googleMapsEmbedUrl: z.string().default(""),
  googleMapsDirectionsUrl: z.string().default(""),
});
export type Business = z.infer<typeof BusinessSchema>;

export const RedirectSchema = z.object({
  oldUrl: z.string(),
  newUrl: z.string(),
  type: z.string(),
  status: z.number().default(301),
});
export type Redirect = z.infer<typeof RedirectSchema>;

export const MediaItemSchema = z.object({
  sourceUrl: z.string(),
  localPath: z.string().default(""),
  alt: z.string().default(""),
  pageUrl: z.string().default(""),
  type: z.enum(["product", "brand", "page", "icon", "banner", "unknown"]).default("unknown"),
  usedBy: z.array(z.string()).default([]),
  requiresManualPermissionReview: z.boolean().default(false),
});
export type MediaItem = z.infer<typeof MediaItemSchema>;

export const ScrapeReportSchema = z.object({
  scrapedAt: z.string(),
  baseUrl: z.string(),
  totalPagesFound: z.number().default(0),
  totalPagesScraped: z.number().default(0),
  totalProducts: z.number().default(0),
  totalCategories: z.number().default(0),
  totalBrands: z.number().default(0),
  totalImages: z.number().default(0),
  failedUrls: z.array(z.object({ url: z.string(), error: z.string() })).default([]),
  duplicateProducts: z.array(z.string()).default([]),
  missingPrices: z.array(z.string()).default([]),
  missingImages: z.array(z.string()).default([]),
  missingAvailability: z.array(z.string()).default([]),
  manualReviewNeeded: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});
export type ScrapeReport = z.infer<typeof ScrapeReportSchema>;
