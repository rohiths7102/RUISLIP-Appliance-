import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, MapPin, Phone, Recycle, Truck, Wrench } from "lucide-react";
import { loadCatalog, getBusiness } from "@/lib/repo";
import { topCategories, toCardItem, poaNamesFrom } from "@/lib/select";
import { TOWNS, townBySlug, milesFromShop, nearestTowns } from "@/lib/areas";
import { getHomepage, toHomepage } from "@/lib/homepage";
import { getPrisma } from "@/lib/prisma";
import { telHref } from "@/lib/format";
import { breadcrumbJsonLd, faqJsonLd, jsonLdScript, SITE } from "@/lib/seo";
import PageHead from "@/components/PageHead";
import ProductCard from "@/components/ProductCard";
export const revalidate = 3600;

/**
 * One page per delivery town (lib/areas.ts) — what a shopper in Harrow or
 * Slough searches for ("washing machine delivered Harrow"), and what AI answer
 * engines quote. Each carries the town's own facts (postcode districts,
 * distance from the shop, nearest towns) so no two read alike, plus
 * HomeGoodsStore + FAQPage + BreadcrumbList structured data.
 */
export function generateStaticParams() {
  return TOWNS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const t = townBySlug((await params).slug);
  if (!t) return { title: "Area not found" };
  const title = `Appliances Delivered & Fitted in ${t.name} (${t.districts.join(", ")})`;
  const description = `Kitchen and home appliances delivered by our own van and fitted in ${t.name}, about ${milesFromShop(t)} miles from our South Ruislip shop. Old appliance recycling. Call 0208 864 5763.`;
  return { title, description, alternates: { canonical: `/areas/${t.slug}` }, openGraph: { title: `${title} | Euronics Ruislip`, description } };
}

export default async function AreaPage({ params }: { params: Promise<{ slug: string }> }) {
  const t = townBySlug((await params).slug);
  if (!t) notFound();
  const [{ products, categories, brands }, business, home] = await Promise.all([
    loadCatalog(),
    getBusiness(),
    getPrisma().then(getHomepage).catch(() => toHomepage(null)),
  ]);
  const miles = milesFromShop(t);
  const districts = t.districts.join(", ");
  const nearby = nearestTowns(t);

  // The owner's own featured row (Admin → Homepage), so every town page shows
  // what he is promoting this week, not a list fixed in code.
  const poaSet = poaNamesFrom(categories, brands);
  const byCode = new Map(products.map((p) => [p.productCode, p]));
  const picks = home.featured.map((f) => byCode.get(f.code)).filter((p): p is NonNullable<typeof p> => !!p?.image).slice(0, 8);
  const departments = topCategories(categories).filter((c) => (c.productCount ?? 0) > 0);

  const faqs = [
    { q: `Do you deliver to ${t.name}?`, a: `Yes. ${t.name} (${districts}) is inside our own delivery area, about ${miles} miles from our shop at ${business.address.postcode}. We deliver in our own van — call ${business.phone} to book a day.` },
    { q: `How quickly can you deliver to ${t.name}?`, a: `If the appliance is in stock locally, usually within a day or two. Call ${business.phone} with the product code and we'll confirm stock and give you a date before you pay.` },
    { q: `Do you install appliances in ${t.name}?`, a: `Yes — our own team fits washing machines, dishwashers, cookers, ovens, hobs, fridge freezers and integrated appliances in ${t.name}, and can take away and recycle the old one.` },
    { q: "How do I buy?", a: `Browse the range on this site, then call ${business.phone} or visit the shop in South Ruislip. Payment, delivery and fitting are arranged with us directly — there is no online checkout.` },
    { q: "Are your prices competitive?", a: "We are a Euronics member and keep our prices in line with Euronics every night; if you see a better price from a major retailer, tell us when you call." },
  ];

  const base = SITE().replace(/\/+$/, "");
  const storeLd = {
    "@context": "https://schema.org",
    "@type": "HomeGoodsStore",
    name: "Jyotsna Electrical — Euronics Ruislip",
    url: base,
    telephone: business.phone,
    address: { "@type": "PostalAddress", postalCode: business.address.postcode, addressLocality: "South Ruislip", addressCountry: "GB" },
    areaServed: { "@type": "City", name: t.name, containedInPlace: { "@type": "Country", name: "United Kingdom" } },
    makesOffer: { "@type": "Offer", itemOffered: { "@type": "Service", name: `Appliance delivery and installation in ${t.name}` } },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(storeLd)} />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(faqJsonLd(faqs))} />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(breadcrumbJsonLd([
        { name: "Home", url: "/" }, { name: "Areas we deliver to", url: "/areas" }, { name: t.name, url: `/areas/${t.slug}` },
      ]))} />

      <PageHead eyebrow={`Delivering to ${t.name} · ${districts}`} title={`Appliances delivered and fitted in ${t.name}`}
        intro={`Our own van, our own fitters — ${t.name} is about ${miles} miles from our South Ruislip shop. To check stock and book a day, call`} />

      <div className="container-x py-12">
        <div className="grid gap-4 sm:grid-cols-3">
          {([
            [Truck, "Own-van delivery", `Delivered to ${t.name} by our own team, not a courier.`],
            [Wrench, "Fitting available", "Washing machines, dishwashers, cookers and integrated appliances."],
            [Recycle, "Old appliance recycling", "We take the old one away when we fit the new one."],
          ] as const).map(([Icon, h, p]) => (
            <div key={h} className="rounded-[4px] border border-ink/10 bg-card p-6">
              <Icon size={20} className="mb-3 text-blue-deep" aria-hidden />
              <h2 className="mb-1.5 font-display text-[19px]">{h}</h2>
              <p className="text-[14px] leading-relaxed text-muted">{p}</p>
            </div>
          ))}
        </div>

        {departments.length > 0 && (
          <section className="mt-14">
            <h2 className="mb-5 font-display text-[30px]">Shop by department</h2>
            <div className="flex flex-wrap gap-2.5">
              {departments.map((c) => (
                <Link key={c.id} href={`/categories/${c.id}`} className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-4 py-2 text-[13.5px] font-medium transition-colors hover:border-blue hover:text-blue-deep">
                  {c.name} <span className="text-muted">{c.productCount}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {picks.length > 0 && (
          <section className="mt-14">
            <div className="mb-5 flex items-end justify-between gap-4">
              <h2 className="font-display text-[30px]">Popular with {t.name} customers this week</h2>
              <Link href="/products" className="hidden text-sm font-semibold text-blue-deep hover:text-blue sm:block">Browse everything →</Link>
            </div>
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-4">
              {picks.map((p) => { const c = toCardItem(p, poaSet); return <ProductCard key={c.id} p={c as never} energyClass={c.energyClass} />; })}
            </div>
          </section>
        )}

        <section className="mt-14 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <h2 className="mb-5 font-display text-[30px]">Questions from {t.name}</h2>
            <dl className="divide-y divide-ink/10 border-y border-ink/10">
              {faqs.map((f) => (
                <div key={f.q} className="py-4">
                  <dt className="mb-1.5 font-semibold">{f.q}</dt>
                  <dd className="text-[14.5px] leading-relaxed text-muted">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>
          <aside className="self-start rounded-[4px] border border-ink/10 bg-card p-7">
            <h2 className="mb-2 flex items-center gap-2 font-display text-[22px]"><MapPin size={18} className="text-blue-deep" aria-hidden /> Nearby, we also deliver to</h2>
            <ul className="mb-6 mt-3 space-y-1.5 text-[14.5px]">
              {nearby.map((n) => (
                <li key={n.slug}><Link href={`/areas/${n.slug}`} className="inline-flex items-center gap-1.5 hover:text-blue-deep">{n.name} <span className="text-muted">({n.districts.join(", ")})</span> <ArrowRight size={13} /></Link></li>
              ))}
            </ul>
            <a href={telHref(business.phone)} className="inline-flex w-full items-center justify-center gap-2 bg-cta px-5 py-3.5 text-[15px] font-bold text-white transition-colors hover:bg-cta-deep">
              <Phone size={16} /> Call {business.phone}
            </a>
            <Link href="/areas" className="mt-3 block text-center text-[13px] font-semibold text-blue-deep hover:text-blue">All {TOWNS.length} areas we deliver to →</Link>
          </aside>
        </section>
      </div>
    </>
  );
}
