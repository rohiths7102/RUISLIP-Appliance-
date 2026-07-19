import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCatalog } from "@/lib/repo";
import { getCategoryById, childCategories, productsInCategory } from "@/lib/select";
import PageHead from "@/components/PageHead";
import ProductBrowser from "@/components/ProductBrowser";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/seo";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { categories } = await loadCatalog();
  const c = getCategoryById(categories, slug);
  if (!c) return { title: "Category not found" };
  return {
    title: c.name,
    description: c.seoDescription || `${c.name} at Euronics Ruislip.`,
    alternates: { canonical: `/categories/${slug}` },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { products, categories } = await loadCatalog();
  const c = getCategoryById(categories, slug);
  if (!c) notFound();

  const items = productsInCategory(products, c.name);
  const brandNames = [...new Set(items.map((p) => p.brand).filter(Boolean))].sort();
  const kids = childCategories(categories, c.id);
  const subNames = kids.map((k) => k.name);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(breadcrumbJsonLd([
        { name: "Home", url: "/" },
        { name: "Appliances", url: "/products" },
        { name: c.name, url: `/categories/${c.id}` },
      ]))} />
      <PageHead eyebrow="Department" title={c.name} intro={c.description ? `${c.description} Call` : "Call"} />

      <div className="container-x py-9">
        {kids.length > 0 && (
          <div className="mb-8 flex flex-wrap gap-2.5">
            {kids.map((k) => (
              <Link key={k.id} href={`/categories/${k.id}`}
                className="rounded-full border border-ink/15 bg-card px-4 py-2 text-[12.5px] font-medium transition-colors hover:border-blue hover:text-blue-deep">
                {k.name} <span className="font-mono text-[11px] text-ink/40">{k.productCount}</span>
              </Link>
            ))}
          </div>
        )}
        {items.length ? (
          <ProductBrowser items={items} brands={brandNames} categories={subNames} />
        ) : (
          <p className="py-16 text-center text-muted">
            Nothing listed here right now — call the shop and we&apos;ll tell you what we can get.
          </p>
        )}
      </div>
    </>
  );
}
