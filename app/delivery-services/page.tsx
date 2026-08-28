import type { Metadata } from "next";
import { Phone, Truck, Wrench, ShieldCheck, Package, Users, Boxes } from "lucide-react";
import { getBusiness } from "@/lib/repo";
import { telHref } from "@/lib/format";
import PageHead from "@/components/PageHead";
import { faqJsonLd, jsonLdScript } from "@/lib/seo";
export const revalidate = 300; // ISR — admin writes purge instantly via revalidateStorefront

export const metadata: Metadata = {
  title: "Delivery & Services",
  description: "Local delivery, installation, disposal and parts from Euronics Ruislip. Call 0208 864 5763 to confirm cost and date.",
  alternates: { canonical: "/delivery-services" },
};

const CARDS = [
  [Truck, "Local delivery", "Our own delivery around Ruislip and the surrounding HA postcodes, with same-day possible subject to stock and location."],
  [Wrench, "Installation & fitting", "Freestanding and built-in appliances installed and tested, with old units disconnected for you."],
  [ShieldCheck, "Gas appliances", "Gas work carried out through Gas Safe registered professionals where applicable — ask us and we'll arrange it."],
  [Package, "Disposal & recycling", "We take away your old appliance and all the packaging, leaving your kitchen clear."],
  [Users, "Upstairs delivery", "Delivery to upstairs rooms and flats where access allows — tell us about access when you call."],
  [Boxes, "Parts ordering", "Order genuine spare parts and accessories for collection from the shop."],
] as const;

export default async function DeliveryPage() {
  const business = await getBusiness();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(faqJsonLd([
        { q: "How do I buy?", a: `Browse online, then call ${business.phone} to confirm availability and price and to arrange payment, delivery and fitting. Quote the product code.` },
        { q: "Do you deliver?", a: `Delivery is local, within ${business.delivery.radius || "our local area"}, and is confirmed with the store. Same-day delivery is subject to stock and location.` },
        { q: "How is payment taken?", a: "Payment is arranged directly with the store, by phone or in person — there is no online checkout." },
        { q: "Do you install appliances?", a: "Yes — installation and fitting are available, along with removal and recycling of your old appliance. Ask in store for details." },
      ]))} />

      <PageHead
        eyebrow="Delivery & services"
        title="Delivered and fitted by people who live nearby."
        intro="Everything below is arranged directly with the shop. Call"
      />

      <section className="container-x max-w-[1080px] py-14">
        <div className="grid gap-[18px] md:grid-cols-2">
          {CARDS.map(([Icon, title, body]) => (
            <div key={title} className="flex items-start gap-5 rounded-[4px] border border-ink/10 bg-card p-7">
              <Icon size={22} className="mt-1 shrink-0 text-blue-deep" />
              <div>
                <h2 className="mb-2 font-display text-[25px] font-medium">{title}</h2>
                <p className="text-sm leading-relaxed text-muted">{body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-6 rounded-[4px] border border-blue/40 bg-blue/[.07] px-8 py-9">
          <div className="max-w-[560px]">
            <h2 className="mb-2 font-display text-[28px]">Are we in your area?</h2>
            <p className="text-[14.5px] leading-relaxed text-[#44586f]">
              We deliver locally around {business.address.postcode} and the surrounding Ruislip postcodes.
              Rather than overpromise, we&apos;d sooner you call — we&apos;ll tell you honestly whether we
              cover you, what it costs and when we can come.
            </p>
          </div>
          <a href={telHref(business.phone)}
            className="inline-flex shrink-0 items-center gap-2.5 rounded-sm bg-blue px-7 py-4 text-[15px] font-bold text-white hover:bg-blue-deep">
            <Phone size={17} /> Call to check coverage
          </a>
        </div>
      </section>
    </>
  );
}
