import type { Metadata } from "next";
import Link from "next/link";
import { getBusiness } from "@/lib/repo";
import { telHref } from "@/lib/format";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Privacy & Cookies",
  description:
    "How Jyotsna Electrical (Euronics Ruislip) uses the personal details you give us through the enquiry form or over the phone, how long we keep them, and what cookies this site sets.",
  alternates: { canonical: "/privacy" },
};

/**
 * UK GDPR Article 13 notice for the only personal data this site collects: the
 * enquiry form (name, phone, optional email, message — see ContactForm.tsx and
 * app/api/enquiries/route.ts, stored on the Enquiry table).
 *
 * The cookie section describes the site as actually built: ConsentAnalytics
 * renders nothing at all unless NEXT_PUBLIC_GA_ID is set, and the gtag scripts
 * are gated behind an explicit "granted" choice — so with analytics off this
 * site sets no cookies beyond the admin session. Keep this page honest if that
 * component changes.
 */

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-3 mt-10 font-display text-[22px] text-navy">{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-3.5 text-[15px] leading-[1.75] text-[#44586f]">{children}</p>
);

export default async function PrivacyPage() {
  const b = await getBusiness();
  const addr = `${b.address.line1}, ${b.address.line2}, ${b.address.county}, ${b.address.postcode}`;
  return (
    <div className="container-x max-w-[820px] py-14">
      <p className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.22em] text-blue-deep">Legal</p>
      <h1 className="mb-4 font-display text-[clamp(30px,4vw,42px)] leading-tight text-navy">Privacy &amp; Cookies</h1>
      <P>
        This notice explains what {b.businessName} does with your personal information. We keep it short
        because we collect very little: we do not sell online, so we never take card details through this site.
      </P>

      <H>Who is responsible</H>
      <P>
        {b.businessName}, {addr}, is the data controller. Contact us on{" "}
        <a href={telHref(b.phone)} className="font-semibold text-blue-deep underline underline-offset-4">{b.phone}</a>
        {b.email ? <> or <a href={`mailto:${b.email}`} className="font-semibold text-blue-deep underline underline-offset-4">{b.email}</a></> : null}.
        {b.companyNumber ? ` Company number ${b.companyNumber}.` : ""}
      </P>

      <H>What we collect, and why</H>
      <P>
        <strong className="text-ink">Enquiries.</strong> When you use the enquiry form we collect your name and
        phone number, your email address if you give one, your message, and the product you were looking at. We
        use it only to answer you and to arrange any sale, delivery or service that follows. The lawful basis is
        our legitimate interest in responding to a request you made of us, and performance of a contract once
        you order.
      </P>
      <P>
        <strong className="text-ink">Phone calls.</strong> If you call us we may note the same details so we can
        quote, order a part or book a delivery.
      </P>
      <P>
        We do not use your details for marketing unless you ask us to, we do not sell or share them with anyone
        for their own marketing, and there is no automated decision-making.
      </P>

      <H>Who else sees it</H>
      <P>
        Only our staff, and the suppliers who run the systems behind this site: our website host and database
        provider, and — where an appliance is delivered or installed by a supplier or manufacturer — that
        company, so they can complete your order. Each is bound to keep your data confidential and to use it
        only on our instructions.
      </P>

      <H>How long we keep it</H>
      <P>
        Enquiries that do not lead to a sale are kept for up to 24 months and then deleted. Where you buy from
        us, we keep the sale record for six years, which is the period HMRC requires and which matches the
        guarantee and statutory-rights window.
      </P>

      <H>Your rights</H>
      <P>
        You can ask us for a copy of the information we hold about you, ask us to correct or delete it, object
        to our using it, or ask us to restrict how we use it. Just call or email — we will respond within one
        month and there is no charge. If you are not satisfied you can complain to the Information
        Commissioner&apos;s Office at ico.org.uk or on 0303 123 1113.
      </P>

      <H>Cookies</H>
      <P>
        This site sets no advertising or tracking cookies. If website analytics are switched on you will see a
        banner first, and nothing is loaded unless you choose &quot;Accept&quot; — choosing to decline leaves
        the site entirely cookie-free apart from the sign-in cookie used by shop staff in the admin area, which
        is strictly necessary and needs no consent.
      </P>

      <P>
        See also our{" "}
        <Link href="/terms" className="font-semibold text-blue-deep underline underline-offset-4">Terms &amp; Conditions</Link>.
      </P>

      <p className="mt-10 border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
        Provided as a starting point and not legal advice — please review before relying on it.
      </p>
    </div>
  );
}
