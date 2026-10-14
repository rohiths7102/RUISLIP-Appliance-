"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

/**
 * The homepage opens on the shop floor (Oct 2026, Sachin's experiment): one
 * continuous dark showroom, each department an appliance standing in its own
 * pool of light, its name as signage on the wall behind it. You walk along it
 * (scroll, swipe, or the arrows). Once, on load, the lights come up bay by bay
 * and the appliances rise into them, then one light sweeps along the floor.
 * Hovering a bay turns its light up and the appliance leans with the cursor.
 * Still for anyone who prefers reduced motion.
 */
export type Bay = { id: string; name: string; count: number; shot: string; from: number | null };

export default function ShowroomFloor({ bays, total }: { bays: Bay[]; total: number }) {
  const floor = useRef<HTMLDivElement>(null);
  const [still, setStill] = useState(true);
  useEffect(() => { setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  // The lean: the cursor's position across the bay, -1..1, read by the CSS.
  const lean = (e: React.PointerEvent<HTMLElement>) => {
    if (still || e.pointerType === "touch") return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--lx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
  };
  const rest = (e: React.PointerEvent<HTMLElement>) => e.currentTarget.style.setProperty("--lx", "0");
  const walk = (dir: 1 | -1) => {
    const el = floor.current; if (!el) return;
    const bay = el.querySelector<HTMLElement>("[data-bay]");
    el.scrollBy({ left: dir * (bay ? bay.offsetWidth * 2 : el.clientWidth / 2), behavior: still ? "auto" : "smooth" });
  };

  return (
    <section aria-labelledby="showroom-heading" className="relative overflow-hidden bg-[#0b1d4d] text-white">
      {/* the wall and the floor: a dark room, lit from above, the floor a shade lighter with a horizon */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_60%_at_50%_0%,#1f4aa0_0,#0b1d4d_60%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[30%] bg-[linear-gradient(180deg,#0e2566_0,#081538_100%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[30%] h-px bg-white/20" />

      <div className="container-x wide relative flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pt-12 lg:pt-16">
        <div className="max-w-[56ch]">
          <h2 id="showroom-heading" className={`font-display text-[clamp(34px,4.2vw,54px)] font-semibold leading-[1.02] tracking-[-0.02em] ${still ? "" : "showroom-wipe"}`}>
            Browse by category
          </h2>
          <p className={`mt-3 text-[16px] leading-relaxed text-white/75 ${still ? "" : "showroom-wipe [animation-delay:160ms]"}`}>
            {total.toLocaleString("en-GB")}+ appliances on the floor. Delivered in our own van, fitted by our own team.
          </p>
        </div>
        <div className={`flex items-center gap-2 ${still ? "" : "showroom-wipe [animation-delay:280ms]"}`}>
          <Link href="/products" className="mr-3 border-b border-white/50 pb-1 text-[13px] font-semibold text-white hover:border-[#ffcc00] hover:text-[#ffcc00]">View all appliances</Link>
          <button type="button" onClick={() => walk(-1)} aria-label="Walk back" className="grid h-11 w-11 place-items-center rounded-full border border-white/35 transition-colors hover:border-white hover:bg-white/10"><ArrowLeft size={18} /></button>
          <button type="button" onClick={() => walk(1)} aria-label="Walk on" className="grid h-11 w-11 place-items-center rounded-full border border-white/35 transition-colors hover:border-white hover:bg-white/10"><ArrowRight size={18} /></button>
        </div>
      </div>

      {/* the floor: a snap-scrolling row of bays, padded to the container's edge */}
      <div ref={floor} className="showroom-floor relative mt-6 flex gap-5 snap-x snap-mandatory overflow-x-auto pb-10 pl-[max(1.5rem,calc((100vw-1760px)/2+3.5rem))] pr-6 lg:mt-8 lg:pb-14">
        {bays.map((b, i) => (
          <Link key={b.id} href={`/categories/${b.id}`} data-bay onPointerMove={lean} onPointerLeave={rest}
            style={{ animationDelay: `${200 + i * 130}ms` }}
            className={`showroom-bay group relative block h-[470px] w-[min(74vw,268px)] shrink-0 snap-start sm:w-[300px] lg:h-[520px] lg:w-[clamp(250px,19vw,320px)] ${still ? "" : "showroom-bay-in"}`}>
            {/* signage on the wall behind the bay, clipped to its own bay so the names don't run together */}
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[40%] overflow-hidden">
              <span className="absolute left-1 top-1 select-none whitespace-nowrap font-display text-[58px] font-semibold leading-none tracking-[-0.03em] text-white/[.08] lg:text-[68px]">{b.name}</span>
            </span>
            {/* the light: a cone from the ceiling, a pool on the floor */}
            <span aria-hidden className="showroom-cone pointer-events-none absolute inset-x-[12%] top-0 h-[70%] bg-[linear-gradient(180deg,rgba(255,255,255,.18),rgba(255,255,255,0)_85%)] [clip-path:polygon(40%_0,60%_0,100%_100%,0_100%)]" />
            <span aria-hidden className="showroom-pool pointer-events-none absolute left-1/2 top-[66%] h-[16%] w-[110%] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(closest-side,rgba(255,255,255,.26),rgba(255,255,255,0))]" />
            {/* the appliance, standing on the floor line at 70%, and its reflection below it */}
            <span className="showroom-stand absolute inset-x-[10%] top-[12%] h-[58%]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.shot} alt="" aria-hidden loading={i < 5 ? "eager" : "lazy"}
                className="showroom-shot h-full w-full object-contain object-bottom drop-shadow-[0_28px_28px_rgba(0,0,0,.55)]" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.shot} alt="" aria-hidden loading="lazy"
                className="absolute left-0 top-full h-full w-full object-contain object-bottom opacity-[.16] [mask-image:linear-gradient(to_top,#000_0%,transparent_45%)] [transform:scaleY(-1)]" />
            </span>
            {/* the plate: name and how many, under the floor line */}
            <span className="absolute inset-x-0 top-[76%] flex items-start justify-between gap-3 pr-5">
              <span>
                <span className="block font-display text-[24px] font-medium leading-[1.05] transition-colors duration-300 group-hover:text-[#ffcc00]">{b.name}</span>
                <span className="mt-1 block text-[13px] text-white/60">{b.count.toLocaleString("en-GB")} models{b.from !== null && <> · from <span className="text-white/90">£{b.from.toLocaleString("en-GB")}</span></>}</span>
              </span>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/30 transition-all duration-300 group-hover:border-[#ffcc00] group-hover:bg-[#ffcc00] group-hover:text-[#0b1d4d]">
                <ArrowRight size={17} />
              </span>
            </span>
          </Link>
        ))}
        <span aria-hidden className="w-6 shrink-0 lg:w-[max(1.5rem,calc((100vw-1760px)/2+3.5rem))]" />
      </div>
      {!still && <span aria-hidden className="showroom-sweep pointer-events-none absolute inset-x-0 bottom-0 h-[30%]" />}
    </section>
  );
}
