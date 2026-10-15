"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The third hero under comparison (Oct 2026): the departments ARE the design.
 * Ten words in the serif, large, down the left; behind them the real shop,
 * photographed from the 3D scan — and the picture is that department's aisle.
 * Move over a word and the shop turns to that aisle; leave it alone and it
 * walks itself, one aisle every few seconds. Tap on a phone. Reduced motion:
 * no walking, no drift, the picture simply changes.
 */
export type Department = { id: string; name: string; count: number };

const DWELL = 4500;

export default function HeroRooms({ total, departments }: { total: number; departments: Department[] }) {
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const still = useRef(false);
  useEffect(() => { still.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches; }, []);
  // walks itself while nobody is pointing at a department
  useEffect(() => {
    if (held || still.current) return;
    const t = setInterval(() => setActive((a) => (a + 1) % departments.length), DWELL);
    return () => clearInterval(t);
  }, [held, departments.length]);
  const current = departments[active];

  return (
    <section aria-labelledby="hero-heading" className="hero-rooms relative isolate overflow-hidden bg-navy text-white">
      {/* the aisles: one photograph per department, the active one showing, drifting slowly */}
      {departments.map((d, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={d.id} src={`/hero/rooms/${d.id}.jpg`} alt="" aria-hidden loading={i === 0 ? "eager" : "lazy"}
          className={`hero-rooms-shot absolute inset-0 h-full w-full object-cover transition-opacity duration-[1100ms] ease-out ${i === active ? "hero-rooms-drift opacity-100" : "opacity-0"}`} />
      ))}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(8,21,56,.88)_0%,rgba(8,21,56,.55)_38%,rgba(8,21,56,.08)_70%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(180deg,rgba(8,21,56,0),rgba(8,21,56,.75))]" />

      <div className="container-x wide relative flex min-h-[min(72vh,700px)] flex-col justify-between py-10 lg:py-12">
        <p className="hero-rooms-rise text-[14px] text-white/70">A member of Euronics, family-run in South Ruislip since 1977.</p>

        {/* the departments: the active one bright, the rest standing back */}
        <nav aria-label="Departments" className="hero-rooms-rise my-8 [animation-delay:120ms]" onPointerLeave={() => setHeld(false)}>
          <h2 id="hero-heading" className="sr-only">Browse by department</h2>
          <ul className="flex gap-x-7 overflow-x-auto pb-2 [scrollbar-width:none] lg:block lg:overflow-visible lg:pb-0 [&::-webkit-scrollbar]:hidden">
            {departments.map((d, i) => (
              <li key={d.id} className="shrink-0 lg:shrink">
                <Link href={`/categories/${d.id}`}
                  onPointerEnter={(e) => { if (e.pointerType !== "touch") { setHeld(true); setActive(i); } }}
                  onFocus={() => { setHeld(true); setActive(i); }} onBlur={() => setHeld(false)}
                  onClick={(e) => { if (i !== active && window.matchMedia("(hover: none)").matches) { e.preventDefault(); setHeld(true); setActive(i); } }}
                  className={`group flex items-baseline gap-3 whitespace-nowrap py-[2px] font-[family-name:var(--font-cormorant)] text-[clamp(30px,3.3vw,50px)] font-medium leading-[1.06] tracking-[-0.01em] outline-none transition-colors duration-500 lg:py-0 ${i === active ? "text-white" : "text-white/40 hover:text-white/70"}`}>
                  {d.name}
                  <span className={`font-sans text-[13px] tracking-normal transition-opacity duration-500 ${i === active ? "opacity-100 text-[#ffcc00]" : "opacity-0 lg:opacity-40"}`}>{d.count.toLocaleString("en-GB")}</span>
                  <ArrowRight size={22} className={`self-center transition-all duration-500 ${i === active ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0"}`} />
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hero-rooms-rise flex flex-wrap items-end justify-between gap-x-8 gap-y-4 [animation-delay:240ms]">
          <p className="max-w-[40ch] text-[15px] leading-relaxed text-white/80">
            <span className="text-white">{current.name}</span>, photographed in our showroom. {total.toLocaleString("en-GB")}+ appliances, delivered in our own van and fitted by our own team.
          </p>
          <Link href="/products" className="inline-flex items-center gap-2 border-b border-white/50 pb-0.5 text-[15px] font-medium transition-colors hover:border-[#ffcc00] hover:text-[#ffcc00]">
            View all appliances <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}
