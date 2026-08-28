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
    <footer className="border-t border-blue/15 bg-navy-3">
      <div className="container-x grid gap-10 py-16 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/euronics-logo.png" alt="Euronics Ruislip" width={290} height={74} className="h-10 w-auto" />
          </div>
          <p className="mb-4 max-w-[300px] text-[13.5px] leading-relaxed text-[#8ea6c4]">
            {business.businessName}. A family-run appliance shop serving Ruislip, South Ruislip and the
            surrounding area since 1977.
          </p>
          <p className="font-display text-[15px] italic text-sky">
            Call to confirm live availability before visiting.
          </p>
        </div>

        <div>
          <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.16em] text-sky">Categories</p>
          <ul className="flex flex-col gap-2.5">
            {CATS.map(([id, name]) => (
              <li key={id}>
                <Link href={`/categories/${id}`} className="text-[13.5px] text-[#a9c3de] transition-colors hover:text-sky">
                  {name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.16em] text-sky">Visit us</p>
          <address className="text-[13.5px] not-italic leading-[1.8] text-[#a9c3de]">
            {business.address.line1}<br />
            {business.address.line2}<br />
            {business.address.county}, {business.address.postcode}
          </address>
          <p className="mt-3.5 text-[13.5px] font-semibold text-paper">Mon–Sat · 9:00–17:30</p>
          <p className="text-[13.5px] text-[#a9c3de]">Sunday · Closed</p>
        </div>

        <div>
          <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.16em] text-sky">More</p>
          <ul className="flex flex-col gap-2.5 text-[13.5px]">
            <li><Link href="/products" className="text-[#a9c3de] hover:text-sky">All appliances</Link></li>
            <li><Link href="/brands" className="text-[#a9c3de] hover:text-sky">Brands</Link></li>
            <li><Link href="/delivery-services" className="text-[#a9c3de] hover:text-sky">Delivery &amp; Services</Link></li>
            <li><Link href="/about" className="text-[#a9c3de] hover:text-sky">About us</Link></li>
            <li><Link href="/contact" className="text-[#a9c3de] hover:text-sky">Contact</Link></li>
            <li><Link href="/terms" className="text-[#a9c3de] hover:text-sky">Terms &amp; Conditions</Link></li>
            <li><Link href="/privacy" className="text-[#a9c3de] hover:text-sky">Privacy &amp; Cookies</Link></li>
          </ul>
          <a href={telHref(business.phone)} className="mt-4 block font-display text-2xl text-sky">
            {business.phone}
          </a>
          {business.socialLinks?.length > 0 && (
            <div className="mt-4 flex gap-2.5">
              {business.socialLinks.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer"
                  className="rounded-full border border-sky/45 px-3 py-1 text-[11px] capitalize text-[#a9c3de] hover:border-blue hover:text-sky">
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
          <div className="container-x flex flex-col gap-1 py-4 text-[11.5px] leading-relaxed text-[#8ea6c4]">
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
        <div className="container-x flex flex-col gap-2 py-5 text-[11.5px] text-[#8ea6c4] md:flex-row md:justify-between">
          <span>© {new Date().getFullYear()} {business.businessName} · Euronics Ruislip. All rights reserved. E&amp;OE.</span>
          <span>Browse online, then call to confirm availability, price, delivery &amp; fitting.</span>
        </div>
      </div>
    </footer>
  );
}
