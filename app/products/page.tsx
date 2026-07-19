import type { Metadata } from "next";
import { loadCatalog } from "@/lib/repo";
import { topCategories } from "@/lib/select";
import PageHead from "@/components/PageHead";
import ProductBrowser from "@/components/ProductBrowser";
export const dynamic = "force-dynamic";

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
  return (
    <>
      <PageHead
        eyebrow="The catalogue"
        title="Appliances"
        intro="Check price, product code and availability — then call"
      />
      <div className="container-x py-9">
        <ProductBrowser items={products} brands={brandNames} categories={catNames} initialQuery={q || ""} />
      </div>
    </>
  );
}
