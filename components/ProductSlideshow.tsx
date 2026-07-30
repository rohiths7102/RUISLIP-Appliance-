"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ArrowRight, Phone } from "lucide-react";

export type Slide = {
  slug: string;
  brand: string;
  title: string;
  category: string;
  productCode: string;
  image: string;
  priceNow: number | null;
  priceWas: number | null;
  saving: number | null;
};

const gbp = (n: number | null) =>
  n === null ? "Call for price" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);

/**
 * Flagship carousel that lives INSIDE the hero, in front of the 4K video.
 * Dark-glass card so it reads as one cinematic unit with the footage — the
 * product itself sits on a white tile (the shots are photographed on white).
 * Slides come from the same loadCatalog() the product pages use, so price,
 * code and link can never drift; `npm run verify:slideshow` proves it.
 */
export default function ProductSlideshow({
  slides,
  intervalMs = 6000,
  className = "",
}: {
  slides: Slide[];
  intervalMs?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const n = slides.length;

  const go = useCallback((i: number) => setIndex(((i % n) + n) % n), [n]);

  useEffect(() => {
    if (n < 2 || paused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    timer.current = setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % n);
    }, intervalMs);
    return () => { if (timer.current) clearInterval(timer.current); };
    // `index` dep restarts the clock on manual nav, keeping the dot's progress fill honest
  }, [n, paused, intervalMs, index]);

  if (!n) return null;

  return (
    <div
      aria-roledescription="carousel"
      aria-label="Featured appliances"
      className={`relative ${className}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#081c37]/80 shadow-[0_40px_90px_-30px_rgba(2,10,22,.8)] backdrop-blur-xl">
        {/* stacked crossfade — every slide shares one grid cell, so looping never
            "rewinds" through the deck; active slide drifts in 24px and fades up */}
        <div className="grid">
          {slides.map((s, i) => (
            <Link
              key={s.slug}
              href={`/products/${s.slug}`}
              aria-hidden={i !== index}
              tabIndex={i === index ? 0 : -1}
              className={`group relative col-start-1 row-start-1 grid w-full grid-cols-1 transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] md:grid-cols-[1.05fr_1fr] ${
                i === index ? "z-[1] translate-x-0 opacity-100" : "pointer-events-none translate-x-6 opacity-0"
              }`}
            >
              {/* giant watermark numeral, like the reference showcase */}
              <span aria-hidden className="pointer-events-none absolute -top-6 right-6 z-0 font-display text-[150px] font-semibold leading-none text-white/[.05] md:text-[210px]">
                {String(i + 1).padStart(2, "0")}
              </span>

              {/* info */}
              <div className="relative z-[1] flex flex-col justify-center gap-3.5 p-7 md:p-11">
                <div className="flex items-center gap-3">
                  <span className="rounded-full border border-sky/30 bg-sky/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-sky">
                    {s.category}
                  </span>
                  <span className="font-mono text-[10.5px] tracking-[0.12em] text-white/40">
                    {String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="line-clamp-2 font-display text-[clamp(26px,3.2vw,42px)] font-medium leading-[1.08] text-[#f4f9ff]">
                  <span className="text-sky">{s.brand}</span> {s.title}
                </h3>
                <p className="font-mono text-[11px] tracking-[0.08em] text-white/45">Code {s.productCode}</p>
                <div className="flex flex-wrap items-baseline gap-3.5">
                  <span className="font-display text-[clamp(32px,3.4vw,46px)] font-semibold text-white">{gbp(s.priceNow)}</span>
                  {s.priceWas ? <span className="text-base text-white/35 line-through">{gbp(s.priceWas)}</span> : null}
                  {s.saving ? (
                    <span className="rounded-full bg-[linear-gradient(118deg,#3f9df0_0%,#1173d4_60%)] px-3.5 py-1.5 text-xs font-bold text-white shadow-[0_8px_20px_-6px_rgba(17,115,212,.7)]">
                      Save {gbp(s.saving)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(118deg,#3f9df0_0%,#1173d4_46%,#0b4a8d_100%)] px-6 py-3 text-sm font-bold text-white shadow-[0_14px_34px_-12px_rgba(17,115,212,.8)] transition-transform group-hover:scale-[1.03]">
                    View this product <ArrowRight size={15} />
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-white/80">
                    <Phone size={14} /> Call to check stock
                  </span>
                </div>
              </div>

              {/* product on a white tile with a blue spotlight halo */}
              <div className="relative z-[1] flex items-center justify-center p-6 md:p-8">
                <div className="absolute inset-0 m-auto h-[70%] w-[70%] rounded-full bg-[radial-gradient(circle,rgba(63,157,240,.28),transparent_65%)] blur-2xl" />
                <div className="relative flex h-full min-h-[240px] w-full items-center justify-center overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_-20px_rgba(2,10,22,.7)] md:min-h-[350px]">
                  {/* fill + object-contain in an 86/84% inset frame — next/image
                      serves right-sized files; priority preloads only slide one */}
                  <div className="relative h-[86%] w-[84%]">
                    <Image
                      src={s.image}
                      alt={`${s.brand} ${s.title}`}
                      fill
                      priority={i === 0}
                      sizes="(max-width: 768px) 92vw, 44vw"
                      className={`shot object-contain transition-transform duration-500 ${i === index ? "scale-100" : "scale-[.9]"}`}
                    />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* controls */}
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3">
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Choose slide">
            {slides.map((s, i) => (
              <button
                key={s.slug}
                role="tab"
                aria-selected={i === index}
                aria-label={`Slide ${i + 1}: ${s.brand} ${s.title}`}
                onClick={() => go(i)}
                className={`relative h-2 overflow-hidden rounded-full transition-all ${i === index ? "w-7 bg-white/25" : "w-2 bg-white/25 hover:bg-sky/60"}`}
              >
                {/* progress pill — remounts on index change so the fill restarts in step with the timer */}
                {i === index ? (
                  <span
                    key={index}
                    className="dot-fill absolute inset-0 rounded-full bg-sky"
                    style={{ animationDuration: `${intervalMs}ms`, animationPlayState: paused ? "paused" : "running" }}
                  />
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="mr-2 hidden font-mono text-[10px] uppercase tracking-[0.14em] text-sky/80 sm:block">
              {slides[index].category}
            </span>
            <button onClick={() => go(index - 1)} aria-label="Previous product"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white transition-colors hover:border-sky hover:text-sky">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => go(index + 1)} aria-label="Next product"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white transition-colors hover:border-sky hover:text-sky">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
