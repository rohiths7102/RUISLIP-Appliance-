"use client";
import Link from "next/link";
import { useState } from "react";
import { Phone, Menu, X } from "lucide-react";
import { telHref } from "@/lib/format";
import OpenNow from "@/components/OpenNow";
import SearchBar from "@/components/SearchBar";
import type { Business } from "@/lib/types";

/**
 * The owner's requested format — his official Euronics storefront's header,
 * "with my name and search bar and same colours": a white bar carrying the
 * Jyotsna Electrical name, the member-of-Euronics mark and a search box, over
 * a solid blue department nav. Phone stays the loudest action (phone-first).
 */

// Stable department slugs (same set the footer links); Brands/Delivery ride the blue row too.
const DEPARTMENTS = [
  ["laundry", "Laundry"], ["refrigeration", "Refrigeration"], ["dishwashers", "Dishwashers"],
  ["cooking", "Cooking"], ["tv-audio", "TV & Audio"], ["floorcare", "Floorcare"],
  ["small-appliances", "Small Appliances"], ["accessories-parts", "Accessories"],
] as const;
const UTILITY = [
  { href: "/brands", label: "Brands" },
  { href: "/delivery-services", label: "Delivery & Services" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export default function Header({ business }: { business: Business }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 shadow-[0_1px_0_var(--color-line)]">
      {/* ---- white bar: name · member mark · search · phone ---- */}
      <div className="border-b border-line bg-paper">
        <div className="container-x flex h-[72px] items-center gap-4">
          <Link href="/" onClick={() => setOpen(false)} aria-label="Jyotsna Electrical — Euronics Ruislip, home" className="flex shrink-0 items-center gap-3">
            <span className="flex flex-col leading-none">
              <span className="font-display text-[22px] font-semibold tracking-tight text-navy">Jyotsna Electrical</span>
              <span className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.22em] text-blue-deep">Est. 1977 · South Ruislip</span>
            </span>
          </Link>

          {/* member-of mark — the badge keeps the star lockup legible on white */}
          <span className="hidden items-center gap-2 border-l border-line pl-4 md:flex">
            <span className="text-[10.5px] leading-tight text-muted">A member of</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/euronics-badge.png" alt="Euronics" width={30} height={30} className="h-[30px] w-[30px] rounded-[7px]" />
          </span>

          <SearchBar className="mx-auto hidden w-full max-w-[380px] lg:flex" />

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <div className="flex flex-col items-end gap-1">
              {/* min-h-11 = 44px: the primary action on a phone-first shop. */}
              <a href={telHref(business.phone)} className="flex min-h-11 items-center gap-2 rounded-full bg-blue px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-blue-deep">
                <Phone size={15} strokeWidth={2.2} />
                <span className="hidden sm:inline">{business.phone}</span>
              </a>
              <OpenNow business={business} tone="light" className="hidden sm:flex" />
            </div>
            <button
              className="flex h-[42px] w-[42px] items-center justify-center rounded-full border border-ink/15 text-navy lg:hidden"
              onClick={() => setOpen(!open)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* ---- blue department nav — the "same colours" row ---- */}
      <nav aria-label="Departments" className="hidden bg-blue lg:block">
        <div className="container-x flex items-center gap-6 overflow-x-auto whitespace-nowrap">
          {DEPARTMENTS.map(([slug, label]) => (
            <Link key={slug} href={`/categories/${slug}`}
              className="border-b-2 border-transparent py-2.5 text-[12.5px] font-semibold tracking-[0.02em] text-white transition-colors hover:border-white hover:text-white">
              {label}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px shrink-0 bg-white/25" aria-hidden />
          {UTILITY.map((u) => (
            <Link key={u.href} href={u.href}
              className="border-b-2 border-transparent py-2.5 text-[12px] font-medium text-white/85 transition-colors hover:border-white hover:text-white">
              {u.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* ---- mobile panel: search + everything ---- */}
      {open && (
        <div className="border-b border-line bg-paper lg:hidden">
          <div className="container-x flex flex-col gap-1 py-3">
            <SearchBar className="mb-2" />
            {DEPARTMENTS.map(([slug, label]) => (
              <Link key={slug} href={`/categories/${slug}`} onClick={() => setOpen(false)}
                className="border-b border-line py-3 text-sm font-medium text-ink">
                {label}
              </Link>
            ))}
            {UTILITY.map((u) => (
              <Link key={u.href} href={u.href} onClick={() => setOpen(false)}
                className="border-b border-line py-3 text-sm text-muted last:border-0">
                {u.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
