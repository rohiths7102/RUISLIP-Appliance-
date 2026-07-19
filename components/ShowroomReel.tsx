import type { Product } from "@/lib/types";

/**
 * The "design movement" from the reference: two rows of real product shots
 * scrolling in opposite directions. Uses the shop's own catalogue imagery, so
 * it's genuinely inside-the-showroom rather than stock photography.
 */
export default function ShowroomReel({ products }: { products: Product[] }) {
  const shots = products.filter((p) => p.image);
  if (shots.length < 8) return null;

  const half = Math.ceil(shots.length / 2);
  const top = shots.slice(0, half);
  const bottom = shots.slice(half);
  // triple each row so the -33.333% keyframe loops seamlessly
  const triple = <T,>(a: T[]) => [...a, ...a, ...a];

  return (
    <section className="relative overflow-hidden bg-navy py-16">
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(63,157,240,.5),transparent)]" />
      <div className="container-x mb-8 flex items-end justify-between">
        <div>
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.24em] text-sky">— Inside the showroom</p>
          <h2 className="font-display text-[40px] font-normal leading-[1.05] text-paper">Real kitchens. Real appliances.</h2>
        </div>
        <p className="hidden font-mono text-[11px] tracking-[0.12em] text-[#8ea6c4] sm:block">the full range ↓</p>
      </div>

      <div className="flex flex-col gap-3.5">
        <Row items={triple(top)} dir="reel-right" />
        <Row items={triple(bottom)} dir="reel-left" />
      </div>
    </section>
  );
}

function Row({ items, dir }: { items: Product[]; dir: "reel-right" | "reel-left" }) {
  return (
    <div className={`flex w-max gap-3.5 ${dir}`} style={{ willChange: "transform" }}>
      {items.map((p, i) => (
        <div key={`${p.id}-${i}`} className="flex h-[200px] w-[300px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.image} alt={p.title} loading="lazy" className="h-full w-full object-contain p-6" />
        </div>
      ))}
    </div>
  );
}
