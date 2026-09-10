"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type Promo = {
  href: string;   // the shelf it sells on our own site
  alt: string;
  wide: string;   // 2220x355 artwork, used from 640px up
  mobile: string; // 386x150 cut, used below that
};

const INTERVAL_MS = 7000;

/**
 * The supplier campaign strip, the way the shop's own Euronics storefront runs
 * it: one full-width slot cross-fading between the current agent-sales banners.
 * The artwork is Euronics' own, already sized for three breakpoints, so it is
 * shown as supplied rather than re-cropped.
 */
export default function PromoBanners({ promos }: { promos: Promo[] }) {
  const [i, setI] = useState(0);
  const paused = useRef(false);
  const n = promos.length;

  useEffect(() => {
    if (n < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => { if (!paused.current) setI((x) => (x + 1) % n); }, INTERVAL_MS);
    return () => clearInterval(t);
  }, [n]);

  if (!n) return null;

  return (
    <div
      onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }}
      onFocus={() => { paused.current = true; }} onBlur={() => { paused.current = false; }}
      /* The slot keeps the artwork's own 2220x355 / 386x150 proportions, so the
         banner is never cropped and never letterboxed. */
      className="relative aspect-[386/150] w-full overflow-hidden sm:aspect-[2220/355]"
    >
      {promos.map((p, k) => (
        <Link key={p.href} href={p.href} aria-hidden={k !== i} tabIndex={k === i ? 0 : -1}
          className={`absolute inset-0 transition-opacity duration-700 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] ${k === i ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <picture>
            <source media="(min-width: 640px)" srcSet={p.wide} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.mobile} alt={p.alt} width={2220} height={355} loading="lazy"
              className="h-full w-full object-cover" />
          </picture>
        </Link>
      ))}

      {n > 1 && (
        <div className="absolute bottom-3 right-4 flex gap-2 sm:bottom-5 sm:right-8" role="tablist" aria-label="Choose promotion">
          {promos.map((p, k) => (
            <button key={p.href} type="button" role="tab" aria-selected={k === i} aria-label={p.alt}
              onClick={() => setI(k)} className="group/pd flex h-6 items-center">
              <span className={`block h-[3px] transition-all duration-500 ${k === i ? "w-8 bg-white" : "w-4 bg-white/45 group-hover/pd:bg-white/75"}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
