import type { Metadata } from "next";
import { loadCatalog } from "@/lib/repo";
import { topCategories, toCardItem, poaNamesFrom } from "@/lib/select";
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
  searchParams: Promise<{ q?: string; cat?: string; max?: string }>;
}) {
  // Google's sitelinks search box (WebSite SearchAction in the layout) lands
  // here as /products?q=… — the query must genuinely pre-fill the search.
  // cat/max arrive from the homepage "Discover products" finder and must
  // genuinely pre-select the browser's own filters.
  const { q, cat, max } = await searchParams;
  const { products, categories } = await loadCatalog();
  const brandNames = [...new Set(products.map((p) => p.brand).filter(Boolean))].sort();
  const catNames = topCategories(categories).map((c) => c.name);
  // Card-only DTO: descriptionHtml/specs/features are ~90% of the ~4.4MB RSC
  // payload for 1,600 products, and the browser grid never reads them.
  const poaSet = poaNamesFrom(categories);
  const items: ProductCardItem[] = products.map((p) => toCardItem(p, poaSet));
  return (
    <>
      <PageHead
        eyebrow="The catalogue"
        title="Appliances"
        intro="Check price, product code and availability — then call"
      />
      <div className="container-x py-9">
        {/* key: a second header search lands on /products?q=… while this page is
            already mounted — initialQuery alone would be ignored by the browser's
            useState, leaving the old results on screen. Remounting on q resets
            every filter to match the new search, like a fresh landing. */}
        <ProductBrowser
          key={`${q || "all"}|${cat || "all"}|${max || "0"}`}
          items={items}
          brands={brandNames}
          categories={catNames}
          initialQuery={q || ""}
          initialCategory={cat || "all"}
          initialMax={Math.max(0, Number(max) || 0)}
        />
      </div>
    </>
  );
}
