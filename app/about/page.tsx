import type { Metadata } from "next";
import { Phone, Users, Wrench, Package } from "lucide-react";
import { getBusiness } from "@/lib/repo";
import { telHref } from "@/lib/format";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About Us",
  description: "Euronics Ruislip (Jyotsna Electrical Ltd) — a family-run appliance shop in South Ruislip since 1977.",
  alternates: { canonical: "/about" },
};

const CARDS = [
  [Users, "Honest advice", "We'll steer you to the right appliance, not the dearest one."],
  [Wrench, "Installation & repairs", "Fitting in-house, plus trusted Gas Safe and repair referrals."],
  [Package, "Parts & landlords", "Genuine parts to order, and packages for landlords and agents."],
] as const;

export default async function AboutPage() {
  const business = await getBusiness();
  return (
    <>
      <section className="relative overflow-hidden bg-navy px-6 py-24">
        <div className="absolute inset-0 bg-[radial-gradient(90%_100%_at_70%_0%,rgba(63,157,240,.13),transparent_55%)]" />
        <div className="relative z-[2] mx-auto max-w-[840px] text-center">
          <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.24em] text-sky">— Our story</p>
          <h1 className="mb-6 font-display text-[clamp(34px,5.5vw,56px)] font-normal leading-[1.06] text-paper">
            The same family, the same high street, since 1977.
          </h1>
          <p className="text-[18px] leading-relaxed text-[#b6cce4]">
            We&apos;re a local, family-run appliance shop in South Ruislip. Two generations on, we still do
            things the way we always have — honest advice, fair prices and proper aftercare from people you
            can actually walk in and talk to.
          </p>
        </div>
      </section>

      <section className="container-x max-w-[1080px] py-20">
        <div className="mb-16 grid items-center gap-14 lg:grid-cols-2">
          <div>
            <h2 className="mb-4 font-display text-[34px] font-normal leading-tight">
              Real shop, real people, real aftersales care
            </h2>
            <p className="mb-4 text-[15.5px] leading-[1.75] text-[#44586f]">
              When something goes wrong three years after you bought it, you want to call the people who sold
              it to you — not navigate a menu. That&apos;s what we&apos;ve offered since the beginning, and
              it&apos;s why so many of our customers are the children of customers.
            </p>
            <p className="text-[15.5px] leading-[1.75] text-[#44586f]">
              {business.businessName} trades as {business.tradingName}. We&apos;ll help you choose the right
              appliance for your kitchen and your budget, arrange installation, and order genuine parts when
              you need them.
            </p>
          </div>
          <div className="rounded-[4px] border border-ink/10 bg-card p-9">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-blue-deep">Find us</p>
            <address className="mb-5 text-[15px] not-italic leading-[1.8] text-ink">
              {business.address.line1}<br />
              {business.address.line2}<br />
              {business.address.county}, {business.address.postcode}
            </address>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-blue-deep">Opening hours</p>
            <p className="mb-5 text-[15px] text-ink">Mon–Sat 9:00–17:30 · Sunday closed</p>
            <a href={telHref(business.phone)} className="inline-flex items-center gap-2 rounded-sm bg-blue px-6 py-3.5 text-[15px] font-bold text-navy hover:bg-sky">
              <Phone size={16} /> {business.phone}
            </a>
          </div>
        </div>

        <div className="grid gap-[18px] md:grid-cols-3">
          {CARDS.map(([Icon, title, body]) => (
            <div key={title} className="rounded-[4px] border border-ink/10 bg-card p-7">
              <Icon size={22} className="text-blue-deep" />
              <h3 className="mb-2 mt-4 font-display text-2xl font-medium">{title}</h3>
              <p className="text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-navy px-6 py-20 text-center">
        <h2 className="mb-6 font-display text-[40px] font-normal text-paper">Pop in, or give us a call.</h2>
        <a href={telHref(business.phone)} className="inline-flex items-center gap-2.5 rounded-sm bg-blue px-8 py-4 text-[15px] font-bold text-navy hover:bg-sky">
          <Phone size={17} /> Call {business.phone}
        </a>
      </section>
    </>
  );
}
