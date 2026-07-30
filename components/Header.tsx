"use client";
import Link from "next/link";
import { useState } from "react";
import { Phone, Menu, X } from "lucide-react";
import { telHref } from "@/lib/format";
import OpenNow from "@/components/OpenNow";
import type { Business } from "@/lib/types";

const NAV = [
  { href: "/products", label: "Appliances" },
  { href: "/categories", label: "Departments" },
  { href: "/brands", label: "Brands" },
  { href: "/delivery-services", label: "Delivery & Services" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export default function Header({ business }: { business: Business }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-blue/20 bg-navy/95 backdrop-blur-md">
      <div className="container-x flex h-[74px] items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-3.5" onClick={() => setOpen(false)} aria-label="Euronics Ruislip — home">
          {/* White-lettered Euronics lockup (transparent PNG) sits directly on the navy header. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/euronics-logo.png" alt="Euronics Ruislip" width={290} height={74} className="h-10 w-auto" />
          <span className="hidden flex-col gap-0.5 border-l border-paper/15 pl-3.5 sm:flex">
            <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-blue">Est. 1977 · South Ruislip</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-paper/80 transition-colors hover:text-sky">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end gap-1">
            {/* min-h-11 = 44px: this is the primary action on a phone-first shop. */}
            <a href={telHref(business.phone)} className="flex min-h-11 items-center gap-2 rounded-sm bg-blue px-4 py-2.5 text-[13px] font-bold text-navy transition-colors hover:bg-sky">
              <Phone size={15} strokeWidth={2.2} />
              <span className="hidden sm:inline">{business.phone}</span>
            </a>
            {/* live open/closed line — desktop only, phones keep the header tight */}
            <OpenNow business={business} tone="dark" className="hidden sm:flex" />
          </div>
          <button
            className="flex h-[42px] w-[42px] items-center justify-center rounded-sm border border-paper/20 bg-paper/5 text-paper lg:hidden"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-blue/20 bg-navy-3/98 lg:hidden">
          <div className="container-x flex flex-col py-2">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
                className="border-b border-paper/10 py-4 text-sm uppercase tracking-[0.1em] text-paper/80 last:border-0">
                {n.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
