"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

/**
 * The stage (Oct 2026, Sachin's hero): the catalogue, one department at a
 * time. Every department stands along the bottom as a small appliance; the
 * chosen one rises onto the stage, enormous, in front of its name set at
 * billboard size, with the real flagship model and its live price on the
 * plate. Left alone the stage walks through the departments; point at one
 * and it comes up. The appliance tilts with the cursor and a sheen crosses
 * it. Reduced motion: no tilt, no sheen, no walking; the picture just changes.
 */
export type StageItem = {
  deptId: string; dept: string; count: number; from: number | null;
  code: string; brand: string; title: string; price: number | null; shot: string;
};

const DWELL = 6000;

export default function HeroStage({ items, total }: { items: StageItem[]; total: number }) {
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  const still = useRef(false);
  const touchX = useRef<number | null>(null);
  useEffect(() => { still.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches; }, []);
  useEffect(() => {
    if (held || still.current) return;
    const t = setInterval(() => setI((n) => (n + 1) % items.length), DWELL);
    return () => clearInterval(t);
  }, [held, items.length]);
  const go = (d: 1 | -1) => setI((n) => (n + d + items.length) % items.length);
  // the tilt and the sheen follow the cursor across the stage: -1..1 each way
  const track = (e: React.PointerEvent<HTMLDivElement>) => {
    if (still.current || e.pointerType === "touch") return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    e.currentTarget.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };
  const rest = (e: React.PointerEvent<HTMLDivElement>) => { e.currentTarget.style.setProperty("--mx", "0"); e.currentTarget.style.setProperty("--my", "0"); setHeld(false); };
  const it = items[i];
  const gbp = (n: number) => `£${n.toLocaleString("en-GB")}`;

  return (
    <section aria-labelledby="hero-heading" className="stage relative isolate overflow-hidden bg-[#eef0f4] text-navy">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_62%_30%,#ffffff_0%,rgba(255,255,255,0)_70%)]" />
      <h2 id="hero-heading" className="sr-only">Browse by department</h2>

      <div onPointerMove={track} onPointerEnter={() => setHeld(true)} onPointerLeave={rest}
        onPointerDown={(e) => { if (e.pointerType === "touch") touchX.current = e.clientX; }}
        onPointerUp={(e) => { if (touchX.current !== null) { const dx = e.clientX - touchX.current; touchX.current = null; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); } }}
        className="container-x wide relative [--mx:0] [--my:0]">
        <div className="grid min-h-[min(56vh,540px)] grid-cols-1 gap-x-8 pt-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:pt-8">
          {/* the billboard: the department's name, letter by letter, the appliance standing in front of it */}
          <div className="relative flex flex-col items-center lg:order-2 lg:flex-row lg:items-end lg:justify-center">
            {/* billboard size, but a long name ("Accessories & Spare Parts") scales to the stage's width */}
            <span key={`w${i}`} aria-hidden style={{ fontSize: `min(clamp(56px, 11vw, 176px), ${(1.15 / it.dept.length).toFixed(4)} * 100vw)` }}
              className="stage-word pointer-events-none relative select-none whitespace-nowrap text-center font-display font-semibold leading-none tracking-[-0.04em] text-navy lg:absolute lg:inset-x-[-12%] lg:top-[2%]">
              {[...it.dept].map((ch, n) => <span key={n} className="stage-letter inline-block" style={{ animationDelay: `${n * 35}ms` }}>{ch === " " ? " " : ch}</span>)}
            </span>
            <div key={`p${i}`} className="stage-prop relative -mt-4 h-[min(38vh,400px)] w-full max-w-[600px] lg:mt-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.shot} alt={`${it.brand} ${it.title}`} className="stage-shot h-full w-full object-contain object-bottom" />
              <span aria-hidden className="stage-sheen pointer-events-none absolute inset-0" style={{ WebkitMaskImage: `url(${it.shot})`, maskImage: `url(${it.shot})` }} />
            </div>
          </div>

          {/* the plate: the department and its flagship, the live price, where to go */}
          <div className="relative mt-6 flex flex-col justify-end gap-y-6 pb-6 lg:order-1 lg:mt-0">
            <div key={`t${i}`} className="stage-plate">
              <p className="text-[14px] text-muted">{it.count.toLocaleString("en-GB")} models{it.from !== null && <> · from {gbp(it.from)}</>}</p>
              <p className="mt-3 text-[14px] text-muted">{it.brand} · {it.code}</p>
              <p className="mt-1 max-w-[40ch] text-[17px] font-medium leading-snug">{it.title}</p>
              <p className="mt-2 font-display text-[clamp(28px,3vw,40px)] leading-none">{it.price !== null ? gbp(it.price) : "Call for price"}</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                <Link href={`/categories/${it.deptId}`} className="inline-flex items-center gap-2 bg-navy px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-blue">
                  Shop {it.dept.toLowerCase()} <ArrowRight size={15} />
                </Link>
                <Link href={`/products/${it.code}`} className="border-b border-navy/40 pb-0.5 text-[14px] font-medium transition-colors hover:border-navy">This model</Link>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <p className="text-[13px] text-muted">{total.toLocaleString("en-GB")}+ appliances, delivered and fitted by our own team</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => go(-1)} aria-label="Previous department" className="grid h-10 w-10 place-items-center rounded-full border border-navy/25 transition-colors hover:border-navy hover:bg-navy hover:text-white"><ArrowLeft size={16} /></button>
                <button type="button" onClick={() => go(1)} aria-label="Next department" className="grid h-10 w-10 place-items-center rounded-full border border-navy/25 transition-colors hover:border-navy hover:bg-navy hover:text-white"><ArrowRight size={16} /></button>
              </div>
            </div>
          </div>
        </div>

        {/* the catalogue: every department standing along the bottom; the chosen one is on the stage */}
        <nav aria-label="Departments" className="stage-rail relative mt-2 border-t border-navy/10">
          <ul className="flex gap-x-2 overflow-x-auto py-3 [scrollbar-width:none] lg:justify-between [&::-webkit-scrollbar]:hidden">
            {items.map((x, n) => (
              <li key={x.deptId} className="shrink-0">
                <button type="button" onPointerEnter={(e) => { if (e.pointerType !== "touch") setI(n); }} onClick={() => setI(n)} onFocus={() => { setHeld(true); setI(n); }} onBlur={() => setHeld(false)}
                  aria-current={n === i ? "true" : undefined} aria-label={`${x.dept}, ${x.count} models`}
                  className={`group flex w-[96px] flex-col items-center gap-1.5 rounded-[4px] px-1 py-2 outline-none transition-colors lg:w-auto lg:min-w-[88px] ${n === i ? "bg-white" : "hover:bg-white/60"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={x.shot} alt="" aria-hidden loading="lazy" className={`h-12 w-12 object-contain object-bottom transition-all duration-500 ${n === i ? "scale-110 opacity-100" : "opacity-60 group-hover:opacity-100"}`} />
                  <span className={`whitespace-nowrap text-[12px] leading-tight ${n === i ? "font-semibold text-navy" : "text-muted"}`}>{x.dept}</span>
                  <span className={`block h-[2px] w-full overflow-hidden rounded bg-navy/10 ${n === i ? "stage-line" : ""}`} />
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  );
}
