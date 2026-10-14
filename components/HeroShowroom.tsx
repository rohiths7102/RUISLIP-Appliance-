import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The homepage opens inside the real shop (Oct 2026, Sachin's experiment): a
 * slow walk along the showroom floor, recorded from the 3D scan of the actual
 * Ruislip store, filling the top of the page. One line of type over it, and
 * the departments as a quiet index along the bottom edge — no cutouts, no
 * cards, nothing invented. The only motion is the walk itself; the type rises
 * once as the picture comes up. Reduced motion gets the still.
 */
export type Department = { id: string; name: string; count: number };

const VIDEO = "/hero/showroom-walk.mp4";
const POSTER = "/hero/showroom-walk.jpg";

export default function HeroShowroom({ total, departments }: { total: number; departments: Department[] }) {
  return (
    <section aria-labelledby="hero-heading" className="hero-walk relative isolate overflow-hidden bg-navy text-white">
      {/* the walk: the still first, the moving picture over it once it can play */}
      <img src={POSTER} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
      <video className="hero-walk-video absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline
        preload="metadata" poster={POSTER} aria-hidden>
        <source src={VIDEO} type="video/mp4" />
      </video>
      {/* legibility: the shop's navy rising from the floor, never a black wash */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(8,21,56,.25)_0%,rgba(8,21,56,0)_25%,rgba(8,21,56,.6)_55%,rgba(8,21,56,.92)_100%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(8,21,56,.55)_0%,rgba(8,21,56,0)_55%)]" />

      <div className="container-x wide relative flex min-h-[min(60vh,600px)] flex-col justify-end pb-8 pt-28 lg:pb-10">
        <h2 id="hero-heading" className="hero-walk-rise max-w-[22ch] font-[family-name:var(--font-cormorant)] text-[clamp(34px,4.2vw,60px)] font-medium leading-[1.02] tracking-[-0.01em] [text-shadow:0_2px_28px_rgba(8,21,56,.7)]">
          Ruislip&rsquo;s appliance showroom,<br />family-run since 1977.
        </h2>
        <p className="hero-walk-rise mt-4 max-w-[48ch] text-[16px] leading-relaxed text-white/85 [animation-delay:120ms]">
          {total.toLocaleString("en-GB")}+ appliances, delivered in our own van and fitted by our own team.
        </p>
        <div className="hero-walk-rise mt-6 flex flex-wrap items-center gap-x-7 gap-y-4 [animation-delay:240ms]">
          <Link href="/products" className="inline-flex items-center gap-2 bg-[#ffcc00] px-6 py-3.5 text-[15px] font-semibold text-navy transition-colors hover:bg-white">
            Browse appliances
          </Link>
          <a href="#showroom-tour" className="inline-flex items-center gap-2 border-b border-white/50 pb-0.5 text-[15px] font-medium transition-colors hover:border-[#ffcc00] hover:text-[#ffcc00]">
            Walk around the showroom <ArrowRight size={16} />
          </a>
        </div>
      </div>

      {/* the departments: one index along the floor line, scrolling sideways on a phone */}
      <nav aria-label="Departments" className="hero-walk-rise relative border-t border-white/15 bg-navy/55 backdrop-blur-md [animation-delay:360ms]">
        <ul className="container-x wide flex gap-x-8 overflow-x-auto py-4 [scrollbar-width:none] lg:justify-between lg:gap-x-4 [&::-webkit-scrollbar]:hidden">
          {departments.map((d) => (
            <li key={d.id} className="shrink-0">
              <Link href={`/categories/${d.id}`} className="group flex items-baseline gap-2 whitespace-nowrap py-1 text-[15px] font-medium text-white transition-colors hover:text-[#ffcc00] focus-visible:text-[#ffcc00] focus-visible:outline-none">
                {d.name}
                <span className="text-[12px] text-white/50 transition-colors group-hover:text-[#ffcc00]/70">{d.count.toLocaleString("en-GB")}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
