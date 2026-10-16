import Link from "next/link";
import { telHref } from "@/lib/format";
import type { Business } from "@/lib/types";

const CATS = [
  ["laundry", "Laundry"], ["refrigeration", "Refrigeration"], ["dishwashers", "Dishwashers"],
  ["cooking", "Cooking"], ["sinks-taps", "Sinks & Taps"], ["tv-audio", "TV & Audio"],
  ["floorcare", "Floorcare"], ["small-appliances", "Small Appliances"], ["accessories-parts", "Accessories & Spare Parts"],
];

export default function Footer({ business }: { business: Business }) {
  return (
    <footer data-site-chrome className="site-footer border-t border-blue/15 bg-navy">
      <div className="container-x grid gap-10 py-16 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/euronics-logo.png" alt="Euronics Ruislip" width={290} height={74} className="h-10 w-auto" />
          </div>
          <p className="mb-4 max-w-[300px] text-[13.5px] leading-relaxed text-paper-2">
            {business.businessName}. A family-run appliance shop serving Ruislip, South Ruislip and the
            surrounding area since 1977.
          </p>
          <p className="font-display text-[15px] italic text-sky">
            Call to confirm live availability before visiting.
          </p>
        </div>

        <div>
          <p className="footer-heading mb-4">Categories</p>
          <ul className="flex flex-col gap-2.5">
            {CATS.map(([id, name]) => (
              <li key={id}>
                <Link href={`/categories/${id}`} className="text-[13.5px] text-paper-2 transition-colors hover:text-white">
                  {name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="footer-heading mb-4">Visit us</p>
          <address className="text-[13.5px] not-italic leading-[1.8] text-paper-2">
            {business.address.line1}<br />
            {business.address.line2}<br />
            {business.address.county}, {business.address.postcode}
          </address>
          <p className="mt-3.5 text-[13.5px] font-semibold text-paper">Mon–Sat · 9:00–17:30</p>
          <p className="text-[13.5px] text-paper-2">Sunday · Closed</p>
        </div>

        <div>
          <p className="footer-heading mb-4">More</p>
          <ul className="flex flex-col gap-2.5 text-[13.5px]">
            <li><Link href="/products" className="text-paper-2 hover:text-white">All appliances</Link></li>
            <li><Link href="/brands" className="text-paper-2 hover:text-white">Brands</Link></li>
            <li><Link href="/delivery-services" className="text-paper-2 hover:text-white">Delivery &amp; Services</Link></li>
            <li><Link href="/about" className="text-paper-2 hover:text-white">About us</Link></li>
            <li><Link href="/contact" className="text-paper-2 hover:text-white">Contact</Link></li>
            <li><Link href="/terms" className="text-paper-2 hover:text-white">Terms &amp; Conditions</Link></li>
            <li><Link href="/privacy" className="text-paper-2 hover:text-white">Privacy &amp; Cookies</Link></li>
          </ul>
          <a href={telHref(business.phone)} className="mt-4 block font-display text-2xl text-sky">
            {business.phone}
          </a>
          {business.socialLinks?.length > 0 && (
            <div className="mt-4 flex gap-2.5">
              {business.socialLinks.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center border border-sky/45 px-3 py-1 text-[12px] capitalize text-paper-2 hover:border-white hover:text-white">
                  {s.platform}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Statutory trading disclosures. Each line renders ONLY when the owner has
          filled the value in the admin — an absent number is lawful, a wrong one
          is not, so nothing here is ever defaulted or placeholdered. */}
      {(business.companyNumber || business.vatNumber || business.registeredOffice) && (
        <div className="border-t border-paper/8">
          <div className="footer-meta container-x flex flex-col gap-1 py-4 text-[11.5px] leading-relaxed text-line">
            {business.companyNumber && (
              <span>
                {business.businessName} is a company registered
                {business.placeOfRegistration ? ` in ${business.placeOfRegistration}` : ""} under
                company number {business.companyNumber}.
              </span>
            )}
            {business.registeredOffice && <span>Registered office: {business.registeredOffice}</span>}
            {business.vatNumber && <span>VAT registration number: {business.vatNumber}</span>}
          </div>
        </div>
      )}

      <div className="border-t border-paper/8">
        <div className="footer-meta container-x flex flex-col gap-2 py-5 text-[11.5px] text-line md:flex-row md:justify-between">
          <span>© {new Date().getFullYear()} {business.businessName} · Euronics Ruislip. All rights reserved. E&amp;OE.</span>
          <span>Browse online, then call to confirm availability, price, delivery &amp; fitting.</span>
        </div>
      </div>
    </footer>
  );
}
