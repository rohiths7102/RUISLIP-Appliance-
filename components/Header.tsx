"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Phone, Menu, X, ChevronDown } from "lucide-react";
import { telHref, waHref } from "@/lib/format";
import OpenNow from "@/components/OpenNow";
import WhatsAppIcon from "@/components/WhatsAppIcon";
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
  ["cooking", "Cooking"], ["sinks-taps", "Sinks & Taps"], ["tv-audio", "TV & Audio"],
  ["coffee-machines", "Coffee Machines"],
  ["floorcare", "Floorcare"], ["small-appliances", "Small Appliances"], ["accessories-parts", "Accessories"],
] as const;
const UTILITY = [
  { href: "/brands", label: "Brands" },
  { href: "/delivery-services", label: "Delivery & Services" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

/** Call (green, the action colour) and WhatsApp (its own green, so it reads as
 *  WhatsApp and not a second "call us"). Both 44px tap targets. The number is
 *  spelt out only from 1024px: between 640 and 1024 the bar has no room for it. */
function ContactButtons({ phone, className = "" }: { phone: string; className?: string }) {
  return (
    <span className={`flex items-center gap-1.5 ${className}`}>
      <a href={telHref(phone)} className="flex min-h-11 items-center gap-2 rounded-sm bg-cta px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-cta-deep">
        <Phone size={15} strokeWidth={2.2} />
        <span className="hidden lg:inline">{phone}</span>
      </a>
      <a href={waHref()} target="_blank" rel="noopener noreferrer"
        aria-label="Message us on WhatsApp"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-[#25D366] text-white transition-colors hover:bg-[#1da851]">
        <WhatsAppIcon />
      </a>
    </span>
  );
}

export default function Header({ business, nav }: { business: Business; nav?: NavData }) {
  const [open, setOpen] = useState(false);
  const shelfSize = nav?.departments.reduce((t, d) => t + d.subs.reduce((s, x) => s + x.count, 0), 0) ?? 0;
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
    <header data-site-chrome className="sticky top-0 z-50 shadow-[0_1px_0_var(--color-line)]">
      {/* ---- white bar: name · member mark · search · phone ---- */}
      <div className="border-b border-line bg-paper">
        <div className="container-x flex h-[72px] items-center gap-2 md:gap-4 lg:h-[88px]">
          {/* The lockup: shop name, then "A member of Euronics". Side by side from
              640px; stacked on a phone, where the two would otherwise push the
              menu button off the right edge of a 360px screen. */}
          <div className="flex shrink-0 flex-col items-start gap-[3px] sm:flex-row sm:items-center sm:gap-3">
            <Link href="/" onClick={() => setOpen(false)} aria-label="Jyotsna Electrical — Euronics Ruislip, home" className="flex shrink-0 items-center gap-3">
              {/* The owner wants the name written, not the old JPG mark, and big. */}
              <span className="shrink-0 font-brand text-[21px] font-bold leading-none tracking-[-0.015em] text-blue-deep sm:text-[25px] lg:text-[31px]">
                Jyotsna Electrical
              </span>
              <span className="hidden font-mono text-[8.5px] uppercase leading-tight tracking-[0.22em] text-blue-deep xl:block">Est. 1977<br />South Ruislip</span>
            </Link>

            {/* The shop's own "A member of euronics" lockup, taken from their live
                site -- blue on white, the version the owner asked for. Needs no
                blue chip behind it: it was drawn for a white bar. */}
            <span className="flex shrink-0 items-center sm:border-l sm:border-line sm:pl-3 md:pl-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/euronics-member.png" alt="A member of Euronics"
                width={320} height={110} className="h-[44px] w-auto shrink-0 sm:h-[48px] md:h-[52px] lg:h-[58px]" />
            </span>
          </div>

          <SearchBar shelfSize={shelfSize} className="mx-auto hidden w-full max-w-[560px] lg:flex" />

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <div className="hidden flex-col items-end gap-1 sm:flex">
              <ContactButtons phone={business.phone} />
              <span className="hidden md:block">
                <OpenNow business={business} tone="light" />
              </span>
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
            by model code, so it has to be on screen from a cold load. On a phone
            the call and WhatsApp buttons sit on this row too: the top bar has
            room for the lockup and the menu, nothing more. */}
        <div className="container-x flex items-center gap-2 pb-3 lg:hidden">
          <SearchBar shelfSize={shelfSize} className="min-w-0 flex-1" />
          <ContactButtons phone={business.phone} className="sm:hidden" />
        </div>
      </div>

      {/* ---- department nav — one solid royal-blue band, flat like the
              reference the owner chose; an eased sliding underline marks the
              current section ---- */}
      {/* Sachin (desktop): "we need to use slider to get to brands, about us
          etc. — compress this so it's all visible". Fourteen links at 16px with
          32px gaps measured 1903px, 544px over a 1366px laptop and still 385px
          over the 1520px container on a 1920px monitor. Tighter type and gaps,
          departments on one row and the four utility links on a slimmer row
          beneath — a single row of all fourteen does not fit a 1366px laptop
          without dropping the chevrons or a department, which is the owner's
          call. The fly-out stays a sibling of the row, not a child. */}
      <nav aria-label="Departments" className="relative hidden bg-blue lg:block"
        onMouseLeave={scheduleClose}
        onKeyDown={(e) => { if (e.key === "Escape") showDept(null); }}>
        <div className="container-x flex flex-wrap items-center gap-x-4">
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
                className={`relative flex items-center gap-1 whitespace-nowrap py-2.5 text-[12.5px] font-semibold tracking-[0.02em] text-white lg:py-[15px] lg:text-[14px] after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:origin-left after:bg-white after:transition-transform after:duration-300 after:[transition-timing-function:cubic-bezier(.2,.8,.2,1)] ${current || openNow ? "after:scale-x-100" : "after:scale-x-0 hover:after:scale-x-100"}`}>
                {label}
                {hasPanel && <ChevronDown size={12} strokeWidth={2.4} className={`transition-transform duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] ${openNow ? "rotate-180" : ""}`} aria-hidden />}
              </Link>
            );
          })}
          <div className="flex basis-full items-center gap-x-5 border-t border-white/15">
          {UTILITY.map((u) => {
            const current = pathname === u.href;
            return (
              <Link key={u.href} href={u.href} aria-current={current ? "page" : undefined}
                className={`relative whitespace-nowrap py-2.5 text-[12px] font-medium text-white lg:py-[9px] lg:text-[13px] after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:origin-left after:bg-white after:transition-transform after:duration-300 after:[transition-timing-function:cubic-bezier(.2,.8,.2,1)] ${current ? "after:scale-x-100" : "after:scale-x-0 hover:after:scale-x-100"}`}>
                {u.label}
              </Link>
            );
          })}
          </div>
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
