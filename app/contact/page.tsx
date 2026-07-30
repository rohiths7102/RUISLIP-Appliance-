import type { Metadata } from "next";
import { Suspense } from "react";
import { Phone, MapPin, Clock, Store } from "lucide-react";
import { getBusiness } from "@/lib/repo";
import { telHref } from "@/lib/format";
import PageHead from "@/components/PageHead";
import ContactForm from "@/components/ContactForm";
export const revalidate = 300; // ISR — admin writes purge instantly via revalidateStorefront

export const metadata: Metadata = {
  title: "Contact & Enquiries",
  description: "Call Euronics Ruislip on 0208 864 5763, or send an enquiry. 724 Fieldend Road, South Ruislip HA4 0QP.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const business = await getBusiness();
  const rows = [
    [Phone, "Phone", business.phone],
    [MapPin, "Address", `${business.address.line1}, ${business.address.line2}, ${business.address.county}, ${business.address.postcode}`],
    [Clock, "Opening hours", "Mon–Sat: 09:00 – 17:30 · Sunday: Closed"],
    [Store, "Store", `${business.businessName} · ${business.tradingName}`],
  ] as const;

  return (
    <>
      <PageHead eyebrow="Visit or call" title="Get in touch" showPhone={false} />
      <div className="container-x grid items-start gap-12 py-12 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <div className="mb-7 rounded-[4px] border border-blue/40 bg-blue/[.07] px-6 py-5">
            <p className="text-sm leading-relaxed text-[#44586f]">
              <strong className="text-ink">Please call before visiting</strong> to confirm a product is in
              stock — it saves you a wasted trip, and we&apos;ll have it ready.
            </p>
          </div>

          <div className="flex flex-col">
            {rows.map(([Icon, label, value]) => (
              <div key={label} className="flex gap-4 border-b border-ink/10 py-5">
                <Icon size={17} className="mt-0.5 shrink-0 text-blue-deep" />
                <div>
                  <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-blue-deep">{label}</p>
                  <p className="text-[15px] font-medium leading-snug text-ink">{value}</p>
                </div>
              </div>
            ))}
          </div>

          <a href={telHref(business.phone)}
            className="mt-6 flex items-center justify-center gap-2.5 rounded-sm bg-blue px-6 py-4 text-base font-bold text-navy hover:bg-sky">
            <Phone size={17} /> Tap to call {business.phone}
          </a>

          {business.googleMapsEmbedUrl && (
            <div className="mt-6 overflow-hidden rounded-[4px] border border-ink/10">
              <iframe
                title={`Map to ${business.tradingName}, ${business.address.postcode}`}
                src={business.googleMapsEmbedUrl}
                className="h-64 w-full grayscale-[.25]"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          )}
        </div>

        <Suspense><ContactForm /></Suspense>
      </div>
    </>
  );
}
