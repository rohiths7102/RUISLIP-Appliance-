import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadCatalog } from "@/lib/repo";
import { getBrandBySlug, productsForBrand, toCardItem } from "@/lib/select";
import PageHead from "@/components/PageHead";
import ProductBrowser from "@/components/ProductBrowser";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/seo";
export const revalidate = 300; // ISR — admin writes purge instantly via revalidateStorefront

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { brands } = await loadCatalog();
  const b = getBrandBySlug(brands, slug);
  if (!b) return { title: "Brand not found" };
  return {
    title: `${b.name} Appliances`,
    description: `${b.name} appliances at Euronics Ruislip. Call 0208 864 5763 to confirm price and availability.`,
    alternates: { canonical: `/brands/${slug}` },
  };
}

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { products, brands } = await loadCatalog();
  const b = getBrandBySlug(brands, slug);
  if (!b) notFound();

  // Card-only DTO (see toCardItem) — keeps specs out of the payload, chips wired.
  const items = productsForBrand(products, b.name).map(toCardItem);
  const catNames = [...new Set(items.map((p) => p.category))].sort();

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(breadcrumbJsonLd([
        { name: "Home", url: "/" }, { name: "Brands", url: "/brands" }, { name: b.name, url: `/brands/${b.slug}` },
      ]))} />
      <PageHead eyebrow="Brand" title={b.name} intro={`${items.length} ${b.name} ${items.length === 1 ? "model" : "models"} listed. Call`} />
      <div className="container-x py-9">
        {items.length ? (
          <ProductBrowser items={items} brands={[b.name]} categories={catNames} />
        ) : (
          <p className="py-16 text-center text-muted">
            No {b.name} models listed right now — call the shop and we&apos;ll tell you what we can order.
          </p>
        )}
      </div>
    </>
  );
}
