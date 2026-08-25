"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Phone, Menu, X, ChevronDown } from "lucide-react";
import { telHref } from "@/lib/format";
import OpenNow from "@/components/OpenNow";
import SearchBar from "@/components/SearchBar";
import MegaMenu, { type NavData } from "@/components/MegaMenu";
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

export default function Header({ business, nav }: { business: Business; nav?: NavData }) {
  const [open, setOpen] = useState(false);
  // Which department's fly-out is showing. Opens on hover OR keyboard focus;
  // closes on a short delay so the diagonal mouse path from trigger to panel
  // doesn't shut it mid-travel.
  const [openDept, setOpenDept] = useState<string | null>(null);
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDept = (id: string | null) => { if (closeT.current) clearTimeout(closeT.current); setOpenDept(id); };
  const scheduleClose = () => { if (closeT.current) clearTimeout(closeT.current); closeT.current = setTimeout(() => setOpenDept(null), 140); };
  const pathname = usePathname();
  // Any navigation closes the mobile panel, not just the department links: the
  // search box inside the panel routes on its own, and on a phone that left the
  // full menu covering the product the customer had just tapped.
  useEffect(() => { setOpen(false); setOpenDept(null); }, [pathname]);
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

          {/* member-of mark — the 512px badge tile is illegible at header scale,
              so the lockup is rebuilt in HTML at a size that actually reads */}
          <span className="hidden items-center gap-2 border-l border-line pl-4 md:flex">
            <span className="text-[10.5px] leading-tight text-muted">A member of</span>
            {/* The real Euronics lockup, never a rebuild of it: the supplied PNG is
                white-on-transparent, so it sits on the brand blue it was drawn for
                rather than being redrawn in HTML on our white bar. */}
            <span className="flex items-center rounded-[5px] bg-[#1e80c6] px-2.5 py-[7px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/euronics-logo.png" alt="Euronics — the home of electricals"
                width={290} height={74} className="h-[26px] w-auto" />
            </span>
          </span>

          <SearchBar className="mx-auto hidden w-full max-w-[440px] lg:flex" />

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <div className="flex flex-col items-end gap-1">
              {/* min-h-11 = 44px: the primary action on a phone-first shop.
                  Green is the action colour in this design — call is the action. */}
              <a href={telHref(business.phone)} className="flex min-h-11 items-center gap-2 rounded-sm bg-cta px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-cta-deep">
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

        {/* Phones and portrait tablets get their own full-width search row. The
            desktop bar's SearchBar is lg:flex, so below 1024px search used to
            live two taps deep inside the hamburger — the shop's customers search
            by model code, so it has to be on screen from a cold load. Its own
            row costs no horizontal space, leaving the green call CTA untouched. */}
        <div className="container-x pb-3 lg:hidden">
          <SearchBar />
        </div>
      </div>

      {/* ---- department nav — one solid royal-blue band, flat like the
              reference the owner chose; an eased sliding underline marks the
              current section ---- */}
      {/* The fly-out is a sibling of the scrolling link row, not a child — the
          row's overflow-x-auto would clip an absolutely-positioned panel. */}
      <nav aria-label="Departments" className="relative hidden bg-blue lg:block"
        onMouseLeave={scheduleClose}
        onKeyDown={(e) => { if (e.key === "Escape") showDept(null); }}>
        <div className="container-x flex items-center gap-6 overflow-x-auto whitespace-nowrap">
          {DEPARTMENTS.map(([slug, label]) => {
            const current = pathname === `/categories/${slug}`;
            const dept = nav?.departments.find((d) => d.id === slug);
            const hasPanel = !!dept && dept.subs.length > 0;
            const openNow = openDept === slug && hasPanel;
            return (
              <Link key={slug} href={`/categories/${slug}`} aria-current={current ? "page" : undefined}
                aria-expanded={hasPanel ? openNow : undefined}
                onMouseEnter={() => (hasPanel ? showDept(slug) : scheduleClose())}
                onFocus={() => (hasPanel ? showDept(slug) : setOpenDept(null))}
                className={`relative flex items-center gap-1 py-2.5 text-[12.5px] font-semibold tracking-[0.02em] text-white after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:origin-left after:bg-white after:transition-transform after:duration-300 after:[transition-timing-function:cubic-bezier(.2,.8,.2,1)] ${current || openNow ? "after:scale-x-100" : "after:scale-x-0 hover:after:scale-x-100"}`}>
                {label}
                {hasPanel && <ChevronDown size={12} strokeWidth={2.4} className={`transition-transform duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] ${openNow ? "rotate-180" : ""}`} aria-hidden />}
              </Link>
            );
          })}
          <span className="mx-1 h-4 w-px shrink-0 bg-white/25" aria-hidden />
          {UTILITY.map((u) => {
            const current = pathname === u.href;
            return (
              <Link key={u.href} href={u.href} aria-current={current ? "page" : undefined}
                className={`relative py-2.5 text-[12px] font-medium text-white after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:origin-left after:bg-white after:transition-transform after:duration-300 after:[transition-timing-function:cubic-bezier(.2,.8,.2,1)] ${current ? "after:scale-x-100" : "after:scale-x-0 hover:after:scale-x-100"}`}>
                {u.label}
              </Link>
            );
          })}
        </div>
        {openDept && nav && (() => {
          const dept = nav.departments.find((d) => d.id === openDept);
          if (!dept || !dept.subs.length) return null;
          return (
            <div onMouseEnter={() => showDept(openDept)} onMouseLeave={scheduleClose}>
              <MegaMenu dept={dept} brands={nav.brands} />
            </div>
          );
        })()}
      </nav>

      {/* ---- mobile panel: departments + utility links.
              No search box here any more — it lives in its own always-visible
              row above, so this panel can't cover the results of a search made
              from inside it (routing to a page you are already on leaves
              `pathname` unchanged, so the close effect never fired).
              Height-capped and scrollable: the full list overflows a phone
              viewport inside a sticky header, stranding the last links. ---- */}
      {open && (
        <div className="border-b border-line bg-paper lg:hidden">
          <div className="container-x flex max-h-[calc(100dvh-140px)] flex-col gap-1 overflow-y-auto py-3">
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
