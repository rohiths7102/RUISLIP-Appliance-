"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The department panels as shop-window displays (Oct 2026, Sachin's
 * experiment: the category grid is the first thing on the homepage).
 *
 * Once, on load: each window's blue wedge sweeps in and the appliance rises
 * onto its shelf, cascading across the grid. On hover: the window tilts
 * towards the cursor, the appliance lifts off the shelf, the wedge widens and
 * a light passes over the glass. Still for anyone who prefers reduced motion.
 */
export type Department = { id: string; name: string; count: number; shot: string; cutout: boolean };

export default function DepartmentWindows({ departments }: { departments: Department[] }) {
  const [still, setStill] = useState(true);
  useEffect(() => { setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);

  // The lean: the cursor's position across the window, -1..1 each way.
  const lean = (e: React.PointerEvent<HTMLElement>) => {
    if (still || e.pointerType === "touch") return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = ((e.clientY - r.top) / r.height) * 2 - 1;
    e.currentTarget.style.setProperty("--lx", x.toFixed(3));
    e.currentTarget.style.setProperty("--ly", y.toFixed(3));
  };
  const rest = (e: React.PointerEvent<HTMLElement>) => { e.currentTarget.style.setProperty("--lx", "0"); e.currentTarget.style.setProperty("--ly", "0"); };

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 [perspective:1200px]">
      {departments.map((d, i) => (
        <Link key={d.id} href={`/categories/${d.id}`} onPointerMove={lean} onPointerLeave={rest}
          style={{ animationDelay: `${120 + i * 90}ms` }}
          className={`dept-window group block overflow-hidden rounded-[6px] border border-line bg-white ${still ? "" : "dept-window-in"}`}>
          {/* the glass: a light panel with the shop's blue wedge sweeping in from the left */}
          <div className="relative aspect-[16/11] overflow-hidden bg-[#eef2f9]">
            <div aria-hidden className={`dept-wedge absolute inset-y-0 left-0 ${d.cutout ? "bg-[#1b3d7d]" : "bg-[#d4dcee]"}`} />
            <div aria-hidden className="dept-sheen pointer-events-none absolute inset-0" />
            {/* the shelf line, and the appliance standing on it */}
            <div aria-hidden className="absolute inset-x-[10%] bottom-[11%] h-px bg-[linear-gradient(90deg,transparent,rgba(16,22,35,.18)_25%,rgba(16,22,35,.18)_75%,transparent)]" />
            {d.shot && (
              <div className={`dept-stand absolute inset-x-[12%] top-[9%] bottom-[11%] ${still ? "" : "dept-stand-in"}`} style={{ animationDelay: `${260 + i * 90}ms` }}>
                <div aria-hidden className="dept-shadow absolute -bottom-2 left-1/2 h-[18px] w-[62%] -translate-x-1/2 rounded-[100%] bg-[#1b3d7d]/[.22] blur-[10px]" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.shot} alt="" aria-hidden loading={i < 6 ? "eager" : "lazy"}
                  className={`dept-shot relative h-full w-full object-contain object-bottom ${d.cutout ? "drop-shadow-[0_18px_26px_rgba(0,0,0,.35)]" : "mix-blend-multiply"}`} />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 px-[22px] py-[18px]">
            <div>
              <h3 className="font-display text-[25px] font-medium leading-[1.05] text-ink">{d.name}</h3>
              <p className="mt-1 text-[13px] text-muted">{d.count.toLocaleString("en-GB")} models</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-full border border-line text-blue transition-colors duration-300 group-hover:border-blue group-hover:bg-blue group-hover:text-white">
              <ArrowRight size={18} />
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
