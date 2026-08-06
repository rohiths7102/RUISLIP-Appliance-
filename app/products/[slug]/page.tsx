import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Phone, MessageCircle, Check } from "lucide-react";
import { loadCatalog } from "@/lib/repo";
import { getProduct, relatedFor, toCardItem, poaNamesFrom } from "@/lib/select";
import { gbp, formatPrice, PRICE_ON_APPLICATION, availabilityLabel, availabilityDot, telHref } from "@/lib/format";
import ProductCard from "@/components/ProductCard";
import ProductGallery from "@/components/ProductGallery";
import { breadcrumbJsonLd, jsonLdScript, SITE } from "@/lib/seo";
export const revalidate = 300; // ISR — admin writes purge instantly via revalidateStorefront

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { products } = await loadCatalog();
  const p = getProduct(products, slug);
  if (!p) return { title: "Product not found" };
  return {
    title: p.seoTitle || p.title,
    description: p.seoDescription || p.shortDescription,
    alternates: { canonical: `/products/${slug}` },
    openGraph: { title: p.title, description: p.seoDescription, images: p.image ? [p.image] : [] },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { products, business, categories } = await loadCatalog();
  const p = getProduct(products, slug);
  if (!p) notFound();

  // Owner-flagged "call for price" category — no price anywhere on this page.
  const poaSet = poaNamesFrom(categories);
  const poa = poaSet.has(p.category) || poaSet.has(p.subcategory);
  const related = relatedFor(products, p);
  const enquiryHref = `/contact?product=${encodeURIComponent(p.title)}&code=${encodeURIComponent(p.productCode)}`;
  // DB rows carry meta: {} — resolve the category page from the catalogue by
  // name (subcategory first) so the breadcrumb and back-link never point at
  // the bare /categories index.
  const catRow = categories.find((c) => c.name === p.subcategory) || categories.find((c) => c.name === p.category);
  const catId = catRow?.id || String(p.meta?.leaf || "");

  // Availability is InStoreOnly on purpose: there is no online checkout, and the
  // shop confirms real stock by phone.
  const schema = {
    "@context": "https://schema.org", "@type": "Product",
    name: p.title, sku: p.productCode, mpn: p.productCode,
    brand: { "@type": "Brand", name: p.brand },
    // Google requires fully-qualified image URLs in structured data; catalogue
    // images are already absolute (Blob), uploads are root-relative.
    image: p.image ? [/^https?:\/\//.test(p.image) ? p.image : SITE() + p.image] : [],
    description: p.shortDescription || p.title,
    ...(p.priceNow !== null && !poa && {
      offers: {
        "@type": "Offer", priceCurrency: "GBP", price: p.priceNow,
        availability: "https://schema.org/InStoreOnly",
        seller: { "@type": "Store", name: business.businessName, telephone: business.phone },
      },
    }),
  };

  return (
    <div className="bg-paper pb-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(schema)} />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(breadcrumbJsonLd([
        { name: "Home", url: "/" },
        { name: "Appliances", url: "/products" },
        { name: p.category, url: `/categories/${catId}` },
        { name: p.title, url: `/products/${slug}` },
      ]))} />

      <div className="container-x pt-7">
        <Link href={`/categories/${catId}`} className="inline-flex items-center gap-2 text-[12.5px] text-muted hover:text-blue-deep">
          ← Back to {p.subcategory}
        </Link>
      </div>

      <div className="container-x grid items-start gap-14 pt-7 lg:grid-cols-2">
        <ProductGallery images={p.gallery} title={p.title} code={p.productCode} fallback={p.subcategory} />

        <div>
          <p className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.2em] text-blue-deep">
            {p.brand} · {p.subcategory}
          </p>
          <h1 className="mb-4 font-display text-display-2 font-normal leading-[1.08] text-balance">{p.title}</h1>

          <div className="mb-2 flex flex-wrap items-center gap-3.5">
            <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold">
              <span className="h-2 w-2 rounded-full" style={{ background: availabilityDot(p.availabilityNormalised) }} />
              {availabilityLabel(p.availabilityNormalised)}
            </span>
            {p.warranty && <><span className="text-ink/20">·</span><span className="text-[12.5px] text-muted">{p.warranty}</span></>}
          </div>

          <div className="my-4 flex flex-wrap items-end gap-3.5">
            {p.priceNow !== null && !poa ? (
              <span className="font-display text-display-2 font-semibold leading-none tabular-nums">{formatPrice(p.priceNow)}</span>
            ) : (
              <span className="inline-flex items-center gap-2 text-lg font-semibold text-blue-deep">
                <Phone size={16} strokeWidth={2.4} /> {PRICE_ON_APPLICATION}
              </span>
            )}
            {!poa && p.priceWas ? <span className="mb-1.5 text-lg text-muted line-through tabular-nums">{formatPrice(p.priceWas)}</span> : null}
            {!poa && p.saving ? (
              <span className="mb-1.5 rounded-sm bg-success-soft px-2.5 py-1.5 text-xs font-bold text-success tabular-nums">Save {formatPrice(p.saving)}</span>
            ) : null}
          </div>
          <p className="mb-6 text-xs text-ink/50">Price shown excludes optional delivery &amp; installation</p>

          <div className="mb-6 rounded-[4px] border border-blue/40 bg-blue/[.07] px-[18px] py-4">
            <p className="text-[13.5px] leading-relaxed text-[#44586f]">
              <strong className="text-ink">Please call to confirm live availability</strong> before visiting or
              arranging delivery. Quote product code{" "}
              <strong className="font-mono text-blue-deep">{p.productCode}</strong> and our team will check
              current stock for you.
            </p>
          </div>

          <div className="mb-7 flex flex-col gap-3 sm:flex-row">
            <a href={telHref(business.phone)}
              className="inline-flex flex-1 items-center justify-center gap-2.5 rounded-sm bg-blue px-6 py-4 text-[15px] font-bold text-navy transition-colors hover:bg-sky">
              <Phone size={17} strokeWidth={2.2} /> Call {business.phone}
            </a>
            <Link href={enquiryHref}
              className="inline-flex flex-1 items-center justify-center gap-2.5 rounded-sm border border-ink/20 px-6 py-4 text-[15px] font-semibold transition-colors hover:border-blue hover:text-blue-deep">
              <MessageCircle size={17} /> Ask about this product
            </Link>
          </div>

          {p.descriptionText && p.descriptionText !== p.title && (
            <div className="border-t border-ink/10 pt-6">
              <h2 className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-blue-deep">Description</h2>
              <p className="text-[15px] leading-[1.75] text-[#44586f]">{p.descriptionText}</p>
            </div>
          )}
        </div>
      </div>

      {p.specifications.length > 0 && (
        <section className="container-x mt-16">
          <h2 className="mb-5 font-display text-display-3 font-normal">Specification</h2>
          <div className="max-w-4xl overflow-hidden rounded-[4px] border border-ink/10 bg-card">
            <table className="w-full text-sm">
              <tbody>
                {p.specifications.map((s, i) => (
                  <tr key={i} className="border-b border-ink/8 last:border-0">
                    <td className="w-1/2 px-5 py-3.5 align-top text-[13.5px] text-muted">{s.label}</td>
                    <td className="px-5 py-3.5 text-[13.5px] font-semibold text-ink">{s.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="container-x mt-16">
        <h2 className="mb-5 font-display text-display-3 font-normal">Delivery &amp; services</h2>
        <p className="mb-6 max-w-3xl text-[14.5px] leading-relaxed text-[#44586f]">
          Delivery available to selected local areas. Please call to confirm availability, delivery cost and
          date — we&apos;ll arrange everything directly with you over the phone.
        </p>
        <ul className="grid gap-3 sm:grid-cols-3">
          {[
            ["Connection & installation", "Fitted and tested by our team"],
            ["Disposal & recycling", "We take your old appliance away"],
            ["Upstairs delivery", "Where access allows — tell us when you call"],
          ].map(([name, note]) => (
            <li key={name} className="rounded-[4px] border border-ink/10 bg-card p-5">
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><Check size={14} className="text-blue" /> {name}</p>
              <p className="text-[12.5px] text-muted">{note}</p>
            </li>
          ))}
        </ul>
      </section>

      {related.length > 0 && (
        <section className="container-x mt-20">
          <h2 className="mb-7 font-display text-display-3 font-normal">You might also like</h2>
          <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
            {related.map((r) => <ProductCard key={r.id} p={toCardItem(r, poaSet) as never} />)}
          </div>
        </section>
      )}

      {/* Sticky call bar — the primary conversion action on every product. */}
      <div className="cta-up fixed inset-x-0 bottom-0 z-40 border-t border-blue/25 bg-navy/96 backdrop-blur-md">
        <div className="container-x flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-paper">{p.title}</p>
            <p className="font-mono text-[10.5px] tracking-[0.06em] text-sky">
              {p.productCode} · {poa || p.priceNow === null ? PRICE_ON_APPLICATION : gbp(p.priceNow)}
            </p>
          </div>
          <a href={telHref(business.phone)}
            className="inline-flex shrink-0 items-center gap-2 rounded-sm bg-blue px-5 py-3 text-sm font-bold text-navy hover:bg-sky">
            <Phone size={15} strokeWidth={2.2} />
            <span className="hidden sm:inline">Call to confirm stock</span>
            <span className="sm:hidden">Call</span>
          </a>
        </div>
      </div>
    </div>
  );
}
