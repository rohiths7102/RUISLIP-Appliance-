import type { Metadata } from "next";
import Link from "next/link";
import { getBusiness } from "@/lib/repo";
import { telHref } from "@/lib/format";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "The terms on which Jyotsna Electrical (Euronics Ruislip) advertises appliances on this website, takes telephone orders, and delivers, installs and services them.",
  alternates: { canonical: "/terms" },
};

/**
 * Terms of the WEBSITE and of the telephone sale it leads to. This shop takes no
 * online payment — every product says "call to confirm" — so there is no checkout
 * contract formed here. A phone order followed by delivery is still a DISTANCE
 * contract under the Consumer Contracts Regulations 2013 (defined by the absence
 * of simultaneous physical presence, not by payment channel), so the 14-day
 * cancellation right is stated rather than omitted.
 *
 * Prices are advertising, not offers: the catalogue is refreshed periodically and
 * can lag, which is the legal basis for the "confirm by phone" model the owner
 * runs. That paragraph is load-bearing — do not soften it.
 *
 * Company number / VAT number / registered office come from the admin and render
 * only when filled in.
 */

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-3 mt-10 font-display text-[22px] text-navy">{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-3.5 text-[15px] leading-[1.75] text-[#44586f]">{children}</p>
);

export default async function TermsPage() {
  const b = await getBusiness();
  const addr = `${b.address.line1}, ${b.address.line2}, ${b.address.county}, ${b.address.postcode}`;
  return (
    <div className="container-x max-w-[820px] py-14">
      <p className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.22em] text-blue-deep">Legal</p>
      <h1 className="mb-4 font-display text-[clamp(30px,4vw,42px)] leading-tight text-navy">Terms &amp; Conditions</h1>
      <P>
        These terms apply to your use of this website and to appliances you buy from {b.businessName}
        {b.tradingName && b.tradingName !== b.businessName ? ` (trading as ${b.tradingName})` : ""}. Please read
        them alongside our <Link href="/privacy" className="font-semibold text-blue-deep underline underline-offset-4">Privacy &amp; Cookies notice</Link>.
      </P>

      <H>1. Who we are</H>
      <P>
        {b.businessName}, {addr}. Telephone{" "}
        <a href={telHref(b.phone)} className="font-semibold text-blue-deep underline underline-offset-4">{b.phone}</a>
        {b.email ? <>, email <a href={`mailto:${b.email}`} className="font-semibold text-blue-deep underline underline-offset-4">{b.email}</a></> : null}.
      </P>
      {(b.companyNumber || b.registeredOffice || b.vatNumber) && (
        <P>
          {b.companyNumber && (
            <>Registered {b.placeOfRegistration ? `in ${b.placeOfRegistration} ` : ""}under company number {b.companyNumber}. </>
          )}
          {b.registeredOffice && <>Registered office: {b.registeredOffice}. </>}
          {b.vatNumber && <>VAT registration number {b.vatNumber}.</>}
        </P>
      )}

      <H>2. This website does not sell to you directly</H>
      <P>
        You cannot pay for anything on this site. Everything shown here is an invitation to contact us — not
        an offer to sell. A contract is only formed when we confirm your order by telephone or in the shop, and
        confirm the price, availability and any delivery or installation charges with you at that time.
      </P>

      <H>3. Prices and availability</H>
      <P>
        Prices shown include VAT and exclude optional delivery and installation unless we say otherwise. Our
        catalogue is refreshed periodically from our suppliers, and a price or stock figure here may be out of
        date. That is why every product asks you to call: <strong className="text-ink">the price we confirm on
        the phone is the price that applies.</strong> If a price on this site is wrong, we are not obliged to
        supply at that price, and we will tell you the correct price before you commit to buying.
      </P>
      <P>
        Product descriptions, photographs and specifications come from manufacturers and are for guidance.
        Always check dimensions and installation requirements with us before ordering.
      </P>

      <H>4. Your right to cancel</H>
      <P>
        If you order by telephone without visiting the shop, that is a distance contract, and under the Consumer
        Contracts (Information, Cancellation and Additional Charges) Regulations 2013 you may cancel within 14
        days of receiving the goods, for any reason. Tell us by phone, email or in writing, return the goods in
        a resaleable condition, and we will refund you within 14 days of getting them back. You pay the cost of
        returning the goods unless they are faulty or wrongly supplied.
      </P>
      <P>
        This right does not apply to goods made or ordered specially to your specification, or to items sealed
        for hygiene reasons once unsealed. Buying in the shop is not a distance contract, so the 14-day right
        does not apply — your statutory rights below do.
      </P>

      <H>5. Faulty goods and your statutory rights</H>
      <P>
        Under the Consumer Rights Act 2015 goods must be of satisfactory quality, fit for purpose and as
        described. If they are not, you are entitled to a repair, replacement or refund depending on when the
        fault appears. Manufacturer guarantees are in addition to these rights and never replace them.
      </P>

      <H>6. Delivery and installation</H>
      <P>
        We deliver locally; the area, charges and timescales are on our{" "}
        <Link href="/delivery-services" className="font-semibold text-blue-deep underline underline-offset-4">Delivery &amp; Services</Link>{" "}
        page and are confirmed when you order. Installation, connection and removal of an old appliance are
        chargeable options. Please make sure the appliance can physically reach its intended position, and that
        the necessary services are in place, before we deliver.
      </P>

      <H>7. Using this website</H>
      <P>
        You may browse this site for your own personal, non-commercial use. You may not use any automated
        system to copy, monitor or extract our catalogue or prices, or reproduce our content without our
        permission. We try to keep the site available and accurate but do not guarantee it will be
        uninterrupted or error-free.
      </P>

      <H>8. Availability, and when we may cancel</H>
      <P>
        Everything on this site is subject to availability. Occasionally a model is discontinued by the
        manufacturer or sells out between your seeing it here and calling us. If we cannot supply what you
        ordered we will tell you promptly, offer the nearest equivalent, and refund anything you have paid if
        you would rather not proceed. We may also cancel an order where the price or description was clearly
        wrong, or where we cannot deliver to your address — again, with a full refund of anything paid.
      </P>

      <H>9. Risk and ownership</H>
      <P>
        The goods become your responsibility when they are delivered to the address you gave us, or when you
        collect them from the shop. They remain our property until we have received payment in full.
      </P>

      <H>10. Repairs and service visits</H>
      <P>
        Where we attend to repair or service an appliance, any charge for the visit is explained to you before
        we book it, and is payable whether or not a repair proves possible. Parts and labour we supply are
        guaranteed for the period we quote at the time. We cannot accept responsibility for a fault caused by
        misuse, accidental damage, or work previously carried out by someone else, and we may decline to work
        on an appliance where doing so would be unsafe.
      </P>

      <H>11. Our responsibility to you</H>
      <P>
        If we fail to meet these terms we are responsible for loss or damage you suffer that is a foreseeable
        result of that failure, but we are not responsible for loss or damage that is not foreseeable. We do
        not exclude or limit our liability in any way where it would be unlawful to do so — this includes
        liability for death or personal injury caused by our negligence, for fraud, and for any breach of your
        statutory rights in the goods.
      </P>
      <P>
        Because we are a shop selling to consumers, we are not liable for business losses. If you buy for a
        business purpose we have no liability for loss of profit, loss of business or loss of opportunity.
      </P>

      <H>12. This website</H>
      <P>
        The text, photographs and layout of this site belong to us or to our suppliers, and may not be copied
        or republished without permission. We make every effort to describe products accurately, but content
        drawn from manufacturers may contain errors, and nothing here forms a term of any contract until we
        confirm it with you. We do not guarantee the site will be free from interruption or error, and we are
        not responsible for the content of any site we link to.
      </P>

      <H>13. Changes to these terms</H>
      <P>
        We may update these terms from time to time — for example when the law changes or we add a service.
        The version published here when you place your order is the version that applies to it.
      </P>

      <H>14. General</H>
      <P>
        If any part of these terms turns out to be unenforceable, the rest continues to apply. Only you and we
        may enforce this contract; no one else acquires rights under it. If we do not insist on something you
        are required to do, or delay in doing so, that does not prevent us from enforcing it later.
      </P>

      <H>15. Complaints and governing law</H>
      <P>
        If something has gone wrong, call us on{" "}
        <a href={telHref(b.phone)} className="font-semibold text-blue-deep underline underline-offset-4">{b.phone}</a>{" "}
        and we will do our best to put it right. These terms are governed by the law of England and Wales, and
        the courts of England and Wales have jurisdiction. Nothing here affects your statutory rights as a
        consumer.
      </P>

      <p className="mt-10 border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
        These terms are provided as a starting point and are not legal advice — please have them reviewed before relying on them.
      </p>
    </div>
  );
}
