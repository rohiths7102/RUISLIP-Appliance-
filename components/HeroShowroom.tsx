"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Check, Phone } from "lucide-react";
import { telHref } from "@/lib/format";

/**
 * EXPERIMENT (Oct 2026, for Sachin): the hero without the slideshow. One still
 * picture that moves a little — three appliances on a lit stage that lean
 * with the mouse, each wearing its real price — the shop's promise beside
 * them, and a live line saying when the prices were last checked. Nothing
 * rotates on its own. (The brand strip stays in the header above.)
 */
export type StageProduct = { slug: string; title: string; brand: string; image: string; price: number | null };

const gbp = (n: number) => `£${n.toLocaleString("en-GB")}`;
// Three on the floor: lead front and tallest, the others stepping back, each on its own depth.
const STAGE = [
  { h: "100%", w: "40%", z: 3, depth: 1, delay: 0 },
  { h: "84%", w: "33%", z: 2, depth: 0.6, delay: 120 },
  { h: "76%", w: "29%", z: 1, depth: 0.35, delay: 240 },
];

export default function HeroShowroom({ products, phone, productCount, pricesCheckedAt }: {
  products: StageProduct[]; phone: string; productCount: number; pricesCheckedAt: string | null;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [still, setStill] = useState(true);
  useEffect(() => { setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);

  // The lean: -1..1 across the stage, applied per depth so the front piece moves most.
  const onMove = (e: React.MouseEvent) => {
    if (still || !stage.current) return;
    const r = stage.current.getBoundingClientRect();
    setTilt({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 });
  };

  return (
    <div className="relative overflow-hidden bg-[radial-gradient(120%_90%_at_80%_10%,#2a56a8_0,#1b3d7d_45%,#0f2a5e_100%)] text-white">
      {/* a faint grid, like the tiles of a showroom floor */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:56px_56px]" />

      <div className="container-x wide relative grid gap-8 pb-10 pt-10 lg:grid-cols-[46%_54%] lg:gap-6 lg:pb-14 lg:pt-16">
        {/* ------------------------------------------------------- the words */}
        <div className="order-2 flex flex-col justify-center lg:order-1 lg:pr-6">
          <p className={`inline-flex w-fit items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] sm:text-[12.5px] sm:tracking-[0.14em] ${still ? "" : "hero-rise"}`}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ffcc00]" /> Euronics member · South Ruislip · est. 1977
          </p>
          <h2 className={`mt-6 font-display text-[clamp(38px,5.2vw,68px)] font-semibold leading-[1.02] tracking-[-0.02em] ${still ? "" : "hero-rise [animation-delay:90ms]"}`}>
            Big-brand appliances.<br />
            <span className="text-[#ffcc00]">We beat or match</span><br />
            the big retailers.
          </h2>
          <p className={`mt-5 max-w-[46ch] text-[16.5px] leading-relaxed text-white/85 ${still ? "" : "hero-rise [animation-delay:180ms]"}`}>
            {productCount.toLocaleString("en-GB")} appliances from Bosch, Neff, Samsung, LG, Miele and more — delivered in our own van,
            fitted by our own team, and the old one taken away.
          </p>
          <div className={`mt-7 flex flex-wrap gap-3 ${still ? "" : "hero-rise [animation-delay:270ms]"}`}>
            <Link href="/products" className="inline-flex items-center gap-2 rounded-full bg-cta px-6 py-3.5 text-[15px] font-bold text-white shadow-[0_10px_30px_rgba(0,0,0,.25)] transition-colors hover:bg-cta-deep">
              Browse the range <ArrowRight size={16} />
            </Link>
            <a href={telHref(phone)} className="inline-flex items-center gap-2 rounded-full border border-white/40 px-6 py-3.5 text-[15px] font-bold text-white transition-colors hover:bg-white/10">
              <Phone size={16} /> {phone}
            </a>
          </div>
          <ul className={`mt-8 grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13.5px] text-white/90 ${still ? "" : "hero-rise [animation-delay:360ms]"}`}>
            {["Price-match promise on every brand", "Own van — delivered in a day or two", "Fitted and tested by our own team", "Old appliance recycled for £30"].map((t) => (
              <li key={t} className="flex items-start gap-2"><Check size={15} className="mt-0.5 shrink-0 text-[#ffcc00]" /> {t}</li>
            ))}
          </ul>
          {pricesCheckedAt && (
            <p className={`mt-7 inline-flex w-fit items-center gap-2 text-[12.5px] text-white/75 ${still ? "" : "hero-rise [animation-delay:450ms]"}`}>
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
              Every price checked against Euronics, Bosch and Neff — last at {pricesCheckedAt}
            </p>
          )}
        </div>

        {/* ------------------------------------------------------- the stage */}
        <div ref={stage} onMouseMove={onMove} onMouseLeave={() => setTilt({ x: 0, y: 0 })}
          className="relative order-1 h-[360px] overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,#ffffff_0,#eef2f9_100%)] shadow-[0_30px_80px_rgba(0,0,0,.35)] sm:h-[440px] lg:order-2 lg:h-[520px] 2xl:h-[600px]">
          {/* the spotlight, and the floor line the range stands on */}
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-30%] h-[120%] w-[90%] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,#fff_0,rgba(255,255,255,0)_70%)]" />
          <div aria-hidden className="pointer-events-none absolute inset-x-[6%] top-[82%] h-px bg-[linear-gradient(90deg,transparent,#c5cfe3_20%,#c5cfe3_80%,transparent)]" />
          <div className="absolute inset-x-[7%] top-[10%] bottom-[18%] flex items-end justify-center">
            <div aria-hidden className="pointer-events-none absolute -bottom-2 left-1/2 h-[22px] w-[70%] -translate-x-1/2 rounded-[100%] bg-[#1b3d7d]/[.14] blur-[14px]" />
            {products.slice(0, 3).map((p, j) => {
              const s = STAGE[j];
              return (
                <Link key={p.slug} href={`/products/${p.slug}`} aria-label={`${p.title}${p.price ? `, ${gbp(p.price)}` : ""}`}
                  className={`group relative block shrink-0 ${still ? "" : "hero-stand"}`}
                  style={{ height: s.h, width: s.w, zIndex: s.z, marginLeft: j ? "-4%" : 0, animationDelay: `${s.delay}ms`,
                    transform: `translate(${tilt.x * 14 * s.depth}px, ${tilt.y * 8 * s.depth}px)`, transition: "transform .35s cubic-bezier(.2,.8,.2,1)" }}>
                  <Image src={p.image} alt={p.title} fill priority={j === 0} sizes="(max-width: 1024px) 40vw, 380px"
                    className="object-contain object-bottom mix-blend-multiply transition-transform duration-500 group-hover:scale-[1.03]" />
                  <Image src={p.image} alt="" aria-hidden fill sizes="(max-width: 1024px) 40vw, 380px"
                    className="!top-full object-contain object-bottom mix-blend-multiply opacity-[.2] [mask-image:linear-gradient(to_top,#000_0%,transparent_38%)] [transform:scaleY(-1)]" />
                  {/* the price tag, hanging off the top corner */}
                  <span className={`absolute right-[-4%] top-[6%] rounded-full px-3 py-1.5 text-[12.5px] font-bold shadow-[0_6px_18px_rgba(0,0,0,.18)] ${p.price ? "bg-[#1b3d7d] text-white" : "bg-white text-[#1b3d7d]"}`}>
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">{p.brand}</span>
                    {p.price ? gbp(p.price) : "Call for best price"}
                  </span>
                </Link>
              );
            })}
          </div>
          <p className="absolute bottom-4 left-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1b3d7d]/60">In the window this week<span className="hidden sm:inline"> · tap any to see it</span></p>
        </div>
      </div>

    </div>
  );
}
