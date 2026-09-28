import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Phone } from "lucide-react";
import { loadCatalog, getBusiness } from "@/lib/repo";
import { toCardItem, poaNamesFrom } from "@/lib/select";
import { LOCAL_DEPARTMENTS, townBySlug, milesFromShop, nearestTowns, townDepartmentHref } from "@/lib/areas";
import { telHref } from "@/lib/format";
import { breadcrumbJsonLd, faqJsonLd, jsonLdScript, SITE } from "@/lib/seo";
import PageHead from "@/components/PageHead";
import ProductCard from "@/components/ProductCard";
export const revalidate = 3600;

/**
 * One page per town and department (/areas/harrow/dishwashers): the local
 * search Google actually gets — "dishwasher harrow", "fridge freezer delivered
 * watford" — answered with that department's products the shop can supply
 * (in stock or available to order first), the town's own facts, and the same
 * FAQ/breadcrumb structured data as the town page. Rendered on demand and kept
 * an hour; the town × department list is in lib/areas.ts.
 */
const STOCK_RANK: Record<string, number> = { in_stock: 0, limited: 1, to_order: 2 };

async function load(slug: string, deptId: string) {
  const t = townBySlug(slug);
  if (!t || !LOCAL_DEPARTMENTS.some((d) => d.id === deptId)) return null;
  const [{ products, categories, brands }, business] = await Promise.all([loadCatalog(), getBusiness()]);
  const cat = categories.find((c) => c.id === deptId);
  if (!cat) return null;
  const poaSet = poaNamesFrom(categories, brands);
  const items = products
    .filter((p) => p.category === cat.name && p.image && p.priceNow !== null && !poaSet.has(p.category) && !poaSet.has(p.subcategory) && !poaSet.has(p.brand))
    .sort((a, b) => (STOCK_RANK[a.availabilityNormalised] ?? 9) - (STOCK_RANK[b.availabilityNormalised] ?? 9));
  return { t, cat, business, poaSet, items, ready: items.filter((p) => p.availabilityNormalised in STOCK_RANK).length };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; dept: string }> }): Promise<Metadata> {
  const { slug, dept } = await params;
  const d = await load(slug, dept);
  if (!d) return { title: "Page not found" };
  const title = `${d.cat.name} Delivered & Fitted in ${d.t.name} (${d.t.districts.join(", ")})`;
  const description = `${d.cat.name} delivered to ${d.t.name} by our own van, about ${milesFromShop(d.t)} miles from our South Ruislip shop, with fitting and old-appliance recycling. ${d.items.length} models. Call ${d.business.phone}.`;
  return { title, description, alternates: { canonical: `/areas/${slug}/${dept}` }, openGraph: { title: `${title} | Euronics Ruislip`, description } };
}

export default async function TownDepartmentPage({ params }: { params: Promise<{ slug: string; dept: string }> }) {
  const { slug, dept } = await params;
  const d = await load(slug, dept);
  if (!d) notFound();
  const { t, cat, business, poaSet, items, ready } = d;
  const name = cat.name.toLowerCase();
  const miles = milesFromShop(t);
  const districts = t.districts.join(", ");
  const nearby = nearestTowns(t, 4);

  const faqs = [
    { q: `Do you deliver ${name} to ${t.name}?`, a: `Yes. ${t.name} (${districts}) is about ${miles} mile${miles === 1 ? "" : "s"} from our shop, inside our own delivery area. We deliver in our own van — call ${business.phone} to book a day.` },
    { q: `Which ${name} can I get quickly in ${t.name}?`, a: ready ? `${ready} of the ${items.length} models on this page are in stock or available to order, usually within a few days. Call with the product code and we'll confirm a date before you pay.` : `Call ${business.phone} with the product code and we'll confirm stock and give you a delivery date before you pay.` },
    { q: `Do you fit ${name} in ${t.name}?`, a: `Yes — our own team delivers and fits in ${t.name}, and can take the old appliance away for recycling. Ask when you call.` },
    { q: "How do I buy?", a: `Choose a model below, then call ${business.phone} or visit the shop in South Ruislip. Payment, delivery and fitting are arranged with us directly — there is no online checkout.` },
  ];
  const base = SITE().replace(/\/+$/, "");
  const listLd = {
    "@context": "https://schema.org", "@type": "ItemList", name: `${cat.name} delivered to ${t.name}`,
    itemListElement: items.slice(0, 12).map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${base}/products/${p.newSlug.replace(/^\/products\//, "")}`, name: p.title })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(listLd)} />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(faqJsonLd(faqs))} />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(breadcrumbJsonLd([
        { name: "Home", url: "/" }, { name: "Areas we deliver to", url: "/areas" }, { name: t.name, url: `/areas/${t.slug}` }, { name: cat.name, url: `/areas/${t.slug}/${cat.id}` },
      ]))} />

      <PageHead eyebrow={`${t.name} · ${districts}`} title={`${cat.name} delivered and fitted in ${t.name}`}
        intro={`${items.length} models, delivered to ${t.name} by our own van from South Ruislip (about ${miles} mile${miles === 1 ? "" : "s"} away) and fitted by our own team. To check stock and book a day, call`} />

      <div className="container-x py-12">
        <section>
          <div className="mb-5 flex items-end justify-between gap-4">
            <h2 className="font-display text-[30px]">{ready ? `${ready} in stock or available to order` : `${cat.name} for ${t.name}`}</h2>
            <Link href={`/categories/${cat.id}`} className="hidden text-sm font-semibold text-blue-deep hover:text-blue sm:block">All {cat.name.toLowerCase()} →</Link>
          </div>
          {items.length ? (
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-4">
              {items.slice(0, 12).map((p) => { const c = toCardItem(p, poaSet); return <ProductCard key={c.id} p={c as never} energyClass={c.energyClass} />; })}
            </div>
          ) : (
            <p className="text-[15px] text-muted">Call {business.phone} — we can order most {name} for {t.name} within a few days.</p>
          )}
          {items.length > 12 && (
            <Link href={`/categories/${cat.id}`} className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-deep hover:text-blue">See all {items.length} {name} <ArrowRight size={14} /></Link>
          )}
        </section>

        <section className="mt-14 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <h2 className="mb-5 font-display text-[30px]">{cat.name} in {t.name} — questions</h2>
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
            <h2 className="mb-2 font-display text-[22px]">{cat.name} nearby</h2>
            <ul className="mb-6 mt-3 space-y-1.5 text-[14.5px]">
              {nearby.map((n) => (
                <li key={n.slug}><Link href={townDepartmentHref(n.slug, cat.id)} className="inline-flex items-center gap-1.5 hover:text-blue-deep">{cat.name} in {n.name} <ArrowRight size={13} /></Link></li>
              ))}
            </ul>
            <h2 className="mb-2 font-display text-[22px]">More for {t.name}</h2>
            <ul className="mb-6 mt-3 space-y-1.5 text-[14.5px]">
              <li><Link href={`/areas/${t.slug}`} className="inline-flex items-center gap-1.5 hover:text-blue-deep">Everything we deliver to {t.name} <ArrowRight size={13} /></Link></li>
            </ul>
            <a href={telHref(business.phone)} className="inline-flex w-full items-center justify-center gap-2 bg-cta px-5 py-3.5 text-[15px] font-bold text-white transition-colors hover:bg-cta-deep">
              <Phone size={16} /> Call {business.phone}
            </a>
          </aside>
        </section>
      </div>
    </>
  );
}
