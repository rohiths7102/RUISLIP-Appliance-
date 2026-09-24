import type { Metadata } from "next";
import Link from "next/link";
import { AREA_GROUPS, TOWNS, milesFromShop } from "@/lib/areas";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/seo";
import PageHead from "@/components/PageHead";
export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Areas We Deliver To — HA, UB, W3–W6, WD3–WD24, SL",
  description: `Own-van appliance delivery and fitting across ${TOWNS.length} towns around Ruislip: Harrow, Watford, Ealing, Uxbridge, Slough and more.`,
  alternates: { canonical: "/areas" },
};

/** Every delivery town, grouped by postcode (lib/areas.ts). */
export default function AreasPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(breadcrumbJsonLd([
        { name: "Home", url: "/" }, { name: "Areas we deliver to", url: "/areas" },
      ]))} />
      <PageHead eyebrow="Delivery area" title="Where we deliver and fit"
        intro={`Our own van covers ${TOWNS.length} towns across the HA, UB, W3–W6, WD3–WD24 and SL postcodes. Not sure about your street? Call`} />
      <div className="container-x py-12">
        <div className="divide-y divide-ink/10 border-y border-ink/10">
          {AREA_GROUPS.map((g) => (
            <section key={g} className="grid gap-4 py-6 sm:grid-cols-[140px_1fr]">
              <h2 className="font-mono text-[14px] font-semibold tracking-[0.08em] text-blue-deep">{g}</h2>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {TOWNS.filter((t) => t.group === g).map((t) => (
                  <li key={t.slug}>
                    <Link href={`/areas/${t.slug}`} className="flex items-baseline justify-between gap-3 rounded-[4px] border border-ink/10 bg-white px-4 py-3 transition-colors hover:border-blue">
                      <span className="font-semibold">{t.name}</span>
                      <span className="text-[12.5px] text-muted">{t.districts.join(", ")} · ~{milesFromShop(t)} mi</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
