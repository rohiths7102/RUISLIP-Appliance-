"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";

/**
 * The homepage opens on the classifications (Sachin, 16 Oct 2026, after the
 * Ruislip Appliances home page): every kind of appliance we stock, its name on
 * a navy bar over a clean product photo, one tap to that shelf.
 *
 * "On the shelf" (planned by Fable and Astra, Oct 2026): each department is one
 * run of shop shelving. The navy name bars join into a rail with a Euronics
 * yellow seam; every product stands on a navy shelf line, bottom-aligned with a
 * small contact shadow, so a fridge and a kettle sit at the same floor level.
 * Once, as a department comes into view, the shelves draw left to right and
 * the stock rises onto them; hovering picks a product off the shelf.
 * Server data, real links; reduced motion gets everything standing still.
 */
export type ClassTile = { id: string; name: string; count: number; image: string };
export type ClassGroup = { id: string; name: string; tiles: ClassTile[] };

export default function HeroClasses({ groups, total }: { groups: ClassGroup[]; total: number }) {
  const root = useRef<HTMLDivElement>(null);
  // a department joins the moment once, the first time it scrolls into view
  useEffect(() => {
    const bays = root.current?.querySelectorAll<HTMLElement>("[data-bay]") ?? [];
    // stock is only held back once this runs, so without JavaScript it simply stands there
    root.current?.classList.add("shelf-armed");
    if (!("IntersectionObserver" in window)) { bays.forEach((b) => b.classList.add("shelf-in")); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("shelf-in"); io.unobserve(e.target); }
    }), { rootMargin: "0px 0px -10% 0px" });
    bays.forEach((b) => io.observe(b));
    return () => io.disconnect();
  }, []);

  return (
    <section aria-labelledby="hero-heading" className="bg-paper">
      <div ref={root} className="container-x wide pb-14 pt-8 lg:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
          <h2 id="hero-heading" className="font-display text-[clamp(28px,3vw,40px)] leading-tight text-navy">Shop by type</h2>
          <p className="text-[14px] text-muted">
            {total.toLocaleString("en-GB")}+ appliances, delivered and fitted by our own team ·{" "}
            <Link href="/categories/accessories-parts" className="text-navy underline-offset-2 hover:underline">Accessories &amp; spare parts</Link>
          </p>
        </div>

        <div className="mt-7 space-y-9">
          {groups.map((g) => (
            <div key={g.id} data-bay className="shelf-bay">
              {/* the bay header: the department, its total, a navy rule */}
              <h3 className="mb-0 flex items-baseline gap-3 border-b-2 border-navy pb-2">
                <Link href={`/categories/${g.id}`} className="font-display text-[22px] leading-none text-navy hover:underline">{g.name}</Link>
                <span className="text-[13px] text-muted">{g.tiles.reduce((n, t) => n + t.count, 0).toLocaleString("en-GB")} models</span>
              </h3>
              {/* one ruled sheet: 1px gaps over the line colour */}
              <ul className="grid grid-cols-2 gap-px border-x border-b border-line bg-line sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {g.tiles.map((t, i) => (
                  <li key={t.id} className="bg-white" style={{ ["--d" as string]: `${i * 55}ms` }}>
                    <Link href={`/categories/${t.id}`} className="shelf-tile group grid h-full grid-rows-[auto_1fr_auto] outline-none">
                      <span className="shelf-ticket relative flex min-h-[44px] items-center bg-blue-deep px-3 py-2 text-[14px] font-semibold leading-tight text-white">
                        {t.name}
                      </span>
                      <span className="shelf-stage relative block aspect-square px-4 pt-4 lg:aspect-[5/4]">
                        <span aria-hidden className="shelf-shadow pointer-events-none absolute bottom-[2px] left-[22%] h-[10px] w-[56%] bg-[radial-gradient(ellipse_at_center,rgba(8,21,56,.18),transparent_70%)]" />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={t.image} alt="" aria-hidden loading={i < 6 ? "eager" : "lazy"}
                          className="shelf-shot shot relative h-full w-full object-contain object-bottom" />
                        <span aria-hidden className="shelf-line pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-navy" />
                      </span>
                      <span className="flex items-center justify-between px-3 pb-2.5 pt-2 text-[12px] text-muted">
                        {t.count.toLocaleString("en-GB")} models
                        <span aria-hidden className="shelf-arrow text-navy">→</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
