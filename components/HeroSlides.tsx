"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Check, ChevronLeft, ChevronRight } from "lucide-react";

export type HeroSlide = {
  eyebrow: string; // the brand (or the shop), set in tracked caps like a supplier banner
  line: string;    // the product type, or the shop's promise
  sub: string;
  cta: string;
  href: string;    // the shelf this slide sells: /products?cat=…&brand=…
  // 1-3 verified cutouts: the lead product first, then supporting pieces of the
  // same brand. A dark ground shows a white box on an opaque shot.
  images: { src: string; alt: string }[];
  logo?: string;   // the brand's own tile, shown in place of the text eyebrow
  chipText?: string;  // the shop's own word beside the mark, e.g. Euronics + Ruislip
  // The brand's departments. One slide per brand with its shelves on it beats a
  // slide per brand-and-department: the owner counted ten pages to flick through
  // to see what one maker offers.
  links?: { label: string; href: string }[];
  logoLight?: boolean; // the mark is drawn in white ink: it goes on the blue, no chip
  wide?: boolean;  // landscape products (televisions): stand them side by side
};

// Lead front and tallest; the others step down behind it on one floor line.
const STEP = [
  { h: "100%", w: "42%", z: 3 },
  { h: "86%",  w: "34%", z: 2 },
  { h: "78%",  w: "30%", z: 1 },
];
// Televisions are as wide as a fridge is tall: overlapped, they read as one
// smeared screen. Stand them in a row instead, still stepping down in size.
const STEP_WIDE = [
  { h: "100%", w: "36%", z: 3 },
  { h: "88%",  w: "31%", z: 2 },
  { h: "78%",  w: "27%", z: 1 },
];

const INTERVAL_MS = 6000;

/**
 * The hero as the shop's own site ran it: a slideshow of brand promotions, one
 * brand and one product type per slide, the whole slide a link to that shelf.
 * Cross-fade, not slide-in. Auto-advances unless the visitor is hovering or
 * has focus inside it, or prefers reduced motion; dots and arrows always work.
 */
export default function HeroSlides({ slides }: { slides: HeroSlide[] }) {
  const [i, setI] = useState(0);
  const paused = useRef(false);
  const n = slides.length;
  const go = (k: number) => setI(((k % n) + n) % n);

  useEffect(() => {
    if (n < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => { if (!paused.current) setI((x) => (x + 1) % n); }, INTERVAL_MS);
    return () => clearInterval(t);
  }, [n]);

  if (!n) return null;

  return (
    <div
      aria-roledescription="carousel" aria-label="Featured brands"
      onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }}
      onFocus={() => { paused.current = true; }} onBlur={() => { paused.current = false; }}
      /* The stage: the shop's blue on the left carrying the words, a lit white
         studio on the right where the appliances stand. Appliance photography
         is shot for white, so every catalogue image works here, and the blue
         becomes the frame rather than the whole picture. On a phone the studio
         is the top band and the blue the bottom. */
      className="relative bg-[linear-gradient(180deg,#f4f6fa_0,#f4f6fa_252px,#1b3d7d_252px)] lg:bg-[linear-gradient(90deg,#1b3d7d_0,#1b3d7d_46%,#f4f6fa_46%)]"
    >
      <div className="relative min-h-[900px] sm:min-h-[860px] lg:min-h-[640px] 2xl:min-h-[740px]">
        {slides.map((s, k) => {
          const on = k === i;
          return (
            <div key={k} aria-hidden={!on}
              aria-label={`Slide ${k + 1} of ${n}: ${s.eyebrow} ${s.line}`}
              className={`group absolute inset-0 grid grid-rows-[252px_1fr] transition-opacity duration-1000 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] lg:grid-cols-[46%_54%] lg:grid-rows-none ${on ? "opacity-100" : "pointer-events-none opacity-0"}`}
            >
              {/* The studio. A floor line at 84%, the range standing on it, and
                  its reflection below, clipped by the panel. Multiply blends the
                  white plate of a catalogue shot into the panel. */}
              <Link href={s.href} tabIndex={-1} aria-hidden
                className={`relative order-1 overflow-hidden lg:order-2 transition-transform duration-[1300ms] [transition-timing-function:cubic-bezier(.2,.8,.2,1)] ${on ? "translate-x-0" : "translate-x-6"}`}>
                <div aria-hidden className="pointer-events-none absolute inset-x-[6%] top-[84%] h-px bg-[linear-gradient(90deg,transparent,#c5cfe3_20%,#c5cfe3_80%,transparent)]" />
                {/* On a wide screen the range drops to make room for the price-check
                    card pinned in the corner; on a phone the card is in normal flow
                    below, so the band keeps its full height. */}
                <div className="absolute inset-x-[8%] top-[9%] bottom-[16%] flex items-end justify-center lg:top-[27%]">
                  <div aria-hidden className="pointer-events-none absolute -bottom-2 left-1/2 h-[22px] w-[70%] -translate-x-1/2 rounded-[100%] bg-[#1b3d7d]/[.14] blur-[14px]" />
                  {s.images.map((im, j) => {
                    const step = (s.wide ? STEP_WIDE : STEP)[j];
                    return (
                      <div key={j} className="relative shrink-0"
                        style={{ height: step.h, width: step.w, zIndex: step.z, marginLeft: j ? (s.wide ? "1.5%" : "-4%") : 0 }}>
                        <Image src={im.src} alt={im.alt} fill priority={k === 0} loading={k === 0 ? undefined : "eager"} sizes="(max-width: 1024px) 45vw, 420px"
                          className="object-contain object-bottom mix-blend-multiply" />
                        {/* the reflection: the same shot flipped, fading out fast */}
                        <Image src={im.src} alt="" aria-hidden fill loading={k === 0 ? undefined : "eager"} sizes="(max-width: 1024px) 45vw, 420px"
                          className="!top-full object-contain object-bottom mix-blend-multiply opacity-[.22] [mask-image:linear-gradient(to_top,#000_0%,transparent_38%)] [transform:scaleY(-1)]" />
                      </div>
                    );
                  })}
                </div>
              </Link>

              {/* The words, on the blue. */}
              <div className="order-2 flex flex-col justify-start px-6 pb-24 pt-5 lg:justify-center lg:order-1 lg:pb-28 lg:pl-[clamp(40px,6vw,120px)] lg:pr-12 lg:pt-10">
                {s.logo && s.logoLight ? (
                  <span className="mb-6 inline-flex w-fit items-center gap-3.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.logo} alt={s.eyebrow} width={290} height={74} className="h-[34px] w-auto sm:h-[42px]" />
                    {s.chipText ? (
                      <span className="border-l border-white/35 pl-3.5 font-display text-[20px] font-bold uppercase leading-none tracking-[0.16em] text-white sm:text-[24px]">
                        {s.chipText}
                      </span>
                    ) : null}
                  </span>
                ) : s.logo ? (
                  /* A white supplier chip: w-fit + explicit height, or the stretch
                     column pulls the tile wide and squashes the wordmark. */
                  <span className="mb-6 inline-flex w-fit items-center gap-3 rounded-[3px] bg-white px-5 py-3 shadow-[0_8px_20px_rgba(0,0,0,.25)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.logo} alt={s.eyebrow} width={270} height={70} className="h-[38px] w-auto sm:h-[46px]" />
                    {s.chipText ? (
                      <span className="border-l border-line pl-3 font-display text-[17px] font-bold uppercase leading-none tracking-[0.14em] text-[#1b3d7d] sm:text-[19px]">
                        {s.chipText}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <p className="mb-6 font-display text-[clamp(24px,3vw,40px)] font-semibold uppercase leading-none tracking-[0.16em] text-white">
                    {s.eyebrow}
                  </p>
                )}
                <p className="font-display text-[clamp(32px,3.6vw,56px)] font-semibold leading-[1.04] tracking-[-0.015em] text-white">
                  {s.line}
                </p>
                <p className="mt-5 max-w-[460px] text-[16px] leading-relaxed text-white/80 lg:text-[17px]">{s.sub}</p>
                {s.links?.length ? (
                  <div className="mt-7 flex flex-wrap gap-2.5">
                    {s.links.map((l) => (
                      <Link key={l.href} href={l.href} tabIndex={on ? 0 : -1}
                        className="rounded-sm border border-white/35 px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:border-white hover:bg-white hover:text-[#1b3d7d]">
                        {l.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
                <Link href={s.href} tabIndex={on ? 0 : -1}
                  className="mt-7 inline-flex w-fit items-center gap-2.5 rounded-sm bg-white px-7 py-4 text-[15px] font-bold text-[#1b3d7d] shadow-[0_10px_24px_rgba(0,0,0,.22)] transition-colors hover:bg-[#eef2fa]">
                  {s.cta}
                  <ArrowRight size={17} className="transition-transform duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)]" />
                </Link>
                {/* What a 40-to-50-year-old wants to know before trusting a shop. */}
                <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-medium text-white/80">
                  {["Family-run since 1977", "Own-van local delivery", "Fitted by our own team"].map((t) => (
                    <li key={t} className="flex items-center gap-1.5"><Check size={14} strokeWidth={2.6} className="text-[#7dd48a]" aria-hidden />{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      <div className="absolute bottom-7 left-6 flex w-[calc(100%-48px)] items-center gap-4 lg:left-[clamp(40px,6vw,120px)] lg:w-[300px]">
        <div className="flex gap-2" role="tablist" aria-label="Choose slide">
          {slides.map((s, k) => (
            /* The bar stays 3px; the BUTTON is 24px tall so it can actually be hit. */
            <button key={k} type="button" role="tab" aria-selected={k === i} aria-label={`${s.eyebrow}: ${s.line}`}
              onClick={() => go(k)} className="group/dot flex h-6 items-center">
              <span className={`block h-[3px] transition-all duration-500 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] ${k === i ? "w-9 bg-white" : "w-4 bg-white/35 group-hover/dot:bg-white/65"}`} />
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => go(i - 1)} aria-label="Previous slide"
            className="flex h-10 w-10 items-center justify-center border border-white/30 text-white transition-colors hover:border-white">
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => go(i + 1)} aria-label="Next slide"
            className="flex h-10 w-10 items-center justify-center border border-white/30 text-white transition-colors hover:border-white">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
