import type { MetadataRoute } from "next";
import { loadCatalog } from "@/lib/repo";
import { slugOf } from "@/lib/select";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const { products, categories, brands } = await loadCatalog();
  const now = new Date();
  return [
    { url: base, lastModified: now, changeFrequency: "weekly", priority: 1 },
    ...["/products", "/categories", "/brands", "/about", "/delivery-services", "/contact"].map((p) => ({ url: base + p, lastModified: now, changeFrequency: "weekly" as const, priority: 0.8 })),
    ...products.map((p) => ({ url: `${base}/products/${slugOf(p)}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...categories.map((c) => ({ url: `${base}/categories/${c.id}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.6 })),
    ...brands.map((b) => ({ url: `${base}/brands/${b.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.5 })),
  ];
}
