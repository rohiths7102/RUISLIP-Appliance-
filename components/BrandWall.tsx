import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The brand wall (Oct 2026, replaces the narrow tape squeezed beside the
 * Quooker box): every brand we stock, full width, on three rows of white
 * tiles over the deep blue, each row drifting its own way at its own pace —
 * a moving wall of the whole range. Quooker stays first, as the owner asked:
 * its stockist line heads the wall. Pointing at a row holds it; every logo is
 * a link. Reduced motion: the rows stand still and scroll by hand.
 */
export type WallBrand = { id: string; name: string; slug: string; logo: string; productCount: number };

const ROWS = [
  { cls: "wall-row-a" }, { cls: "wall-row-b" }, { cls: "wall-row-c" },
] as const;

export default function BrandWall({ brands }: { brands: WallBrand[] }) {
  // dealt round-robin, so each row carries big and small brands alike
  const rows = ROWS.map((_, r) => brands.filter((_, i) => i % ROWS.length === r));
  return (
    <section aria-label="Brands we stock" className="brand-wall relative overflow-hidden bg-navy text-white">
      <div className="container-x wide flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pb-4 pt-5">
        <p className="text-[15px] font-semibold">
          {brands.length} brands on our floor <span className="font-normal text-white/70">· every one delivered and fitted by us</span>
        </p>
        <Link href="/brands/quooker" className="group inline-flex items-center gap-3 bg-white py-2 pl-3 pr-4 text-navy transition-colors hover:bg-paper-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brands/quooker.svg" alt="Quooker" width={132} height={48} className="h-[22px] w-auto" />
          <span className="text-[13.5px] font-semibold">Quooker stockist — unbeatable prices</span>
          <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-[3px]" />
        </Link>
      </div>
      <div className="space-y-2.5 pb-5 [mask-image:linear-gradient(90deg,transparent,#000_4%,#000_96%,transparent)]">
        {rows.map((row, r) => (
          <div key={r} className="wall-track group/row overflow-hidden">
            <div className={`${ROWS[r].cls} flex w-max gap-2.5 group-hover/row:[animation-play-state:paused] group-focus-within/row:[animation-play-state:paused]`}>
              {[...row, ...row].map((b, i) => (
                <Link key={`${b.id}-${i}`} href={`/brands/${b.slug}`} title={`${b.name} — ${b.productCount} models`}
                  aria-hidden={i >= row.length} tabIndex={i >= row.length ? -1 : undefined}
                  className="wall-tile flex h-[58px] w-[148px] shrink-0 items-center justify-center bg-white px-4 outline-none sm:h-[66px] sm:w-[176px]">
                  {b.logo ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={b.logo} alt={`${b.name} logo`} loading="lazy" className="max-h-[30px] max-w-[86%] object-contain" />
                  ) : (
                    <span className="text-center text-[13px] font-bold leading-tight text-navy">{b.name}</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
