/**
 * Slim persistent USP bar under the header — the four answers every white-goods
 * customer wants before anything else, stated once and honestly (AO's trust
 * play executed with local truth). Facts only: these claims already appear on
 * the delivery/about pages; keep the two lists in step if they change.
 *
 * On a desktop the four utility links (Brands, Delivery & Services, About,
 * Contact) sit at its right end, so the header is two bands, not three; on a
 * phone they live in the menu panel (Header.tsx).
 */
import Link from "next/link";
import { Truck, Wrench, Recycle, Users } from "lucide-react";

const USPS = [
  [Truck, "Own-van local delivery"],
  [Wrench, "Installation & fitting"],
  [Recycle, "Old appliance recycling"],
  [Users, "Family-run since 1977"],
] as const;

const UTILITY = [
  { href: "/brands", label: "Brands" },
  { href: "/delivery-services", label: "Delivery & Services" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export default function UspStrip() {
  return (
    <div data-site-chrome className="border-b border-line bg-paper-2">
      <div className="container-x flex items-center justify-between gap-6 py-2">
        {/* Navy sentence-case text with icon chips — this bar carries the shop's
            four best claims and must read as information, not decoration. */}
        <div className="flex min-w-0 flex-1 items-center justify-between gap-5 overflow-x-auto lg:justify-start lg:gap-7">
          {USPS.map(([Icon, label]) => (
            <span key={label} className="flex shrink-0 items-center gap-2.5 text-[12px] font-semibold tracking-[0.01em] text-navy">
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-blue/10">
                <Icon size={12.5} strokeWidth={2.4} className="text-blue-deep" aria-hidden />
              </span>
              {label}
            </span>
          ))}
        </div>
        <nav aria-label="Shop information" className="hidden shrink-0 items-center gap-5 lg:flex">
          {UTILITY.map((u) => (
            <Link key={u.href} href={u.href} className="whitespace-nowrap text-[12.5px] font-semibold text-blue-deep underline-offset-4 hover:underline">
              {u.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
