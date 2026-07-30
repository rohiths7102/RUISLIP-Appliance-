import type { Metadata } from "next";
import Link from "next/link";
import { loadCatalog } from "@/lib/repo";
import PageHead from "@/components/PageHead";
export const revalidate = 300; // ISR — admin writes purge instantly via revalidateStorefront

export const metadata: Metadata = {
  title: "Brands",
  description: "The appliance brands stocked and serviced by Euronics Ruislip.",
  alternates: { canonical: "/brands" },
};

export default async function BrandsPage() {
  const { brands } = await loadCatalog();
  const sorted = [...brands].sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));
  return (
    <>
      <PageHead eyebrow="Brands" title="Brands we stock" intro="Can't see the brand you're after? We can order far more than we can list — call" />
      <div className="container-x py-9">
        {/* Logos are the shop's own assets, carried over from their current site
            (kitchen-appliances.co.uk); brands without one fall back to a wordmark. */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((b) => (
            <Link key={b.id} href={`/brands/${b.slug}`}
              className="card-lift flex flex-col items-center justify-center rounded-lg border border-line bg-white px-4 py-8 text-center">
              {b.logo ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={b.logo} alt={`${b.name} logo`} loading="lazy" className="max-h-[44px] max-w-[70%] object-contain" />
              ) : (
                <span className="text-[19px] font-bold uppercase tracking-[0.08em] text-navy">{b.name}</span>
              )}
              <span className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-blue-deep">
                {b.productCount} {b.productCount === 1 ? "model" : "models"}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
