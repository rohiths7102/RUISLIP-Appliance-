import type { Metadata } from "next";
import { loadCatalog } from "@/lib/repo";
import { topCategories } from "@/lib/select";
import PageHead from "@/components/PageHead";
import ProductBrowser, { type ProductCardItem } from "@/components/ProductBrowser";
export const revalidate = 300; // ISR — admin writes purge instantly via revalidateStorefront

export const metadata: Metadata = {
  title: "All Appliances",
  description: "Browse the full range of kitchen and home appliances at Euronics Ruislip. Check price, product code and availability, then call 0208 864 5763 to confirm stock.",
  alternates: { canonical: "/products" },
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // Google's sitelinks search box (WebSite SearchAction in the layout) lands
  // here as /products?q=… — the query must genuinely pre-fill the search.
  const { q } = await searchParams;
  const { products, categories } = await loadCatalog();
  const brandNames = [...new Set(products.map((p) => p.brand).filter(Boolean))].sort();
  const catNames = topCategories(categories).map((c) => c.name);
  // Card-only DTO: descriptionHtml/specs/features are ~90% of the ~4.4MB RSC
  // payload for 1,600 products, and the browser grid never reads them.
  const items: ProductCardItem[] = products.map((p) => ({
    id: p.id, newSlug: p.newSlug, title: p.title, brand: p.brand, productCode: p.productCode,
    category: p.category, subcategory: p.subcategory, image: p.image,
    priceNow: p.priceNow, priceWas: p.priceWas, saving: p.saving,
    availability: p.availability, availabilityNormalised: p.availabilityNormalised,
  }));
  return (
    <>
      <PageHead
        eyebrow="The catalogue"
        title="Appliances"
        intro="Check price, product code and availability — then call"
      />
      <div className="container-x py-9">
        <ProductBrowser items={items} brands={brandNames} categories={catNames} initialQuery={q || ""} />
      </div>
    </>
  );
}
