import Link from "next/link";
import { Phone } from "lucide-react";
import type { Product } from "@/lib/types";
import { slugOf } from "@/lib/select";
import { gbp, availabilityDot, telHref, STORE_PHONE } from "@/lib/format";

export default function ProductCard({ p }: { p: Product }) {
  const slug = slugOf(p);
  return (
    <div className="card-lift flex h-full flex-col overflow-hidden rounded-[5px] border border-ink/10 bg-card">
      <Link href={`/products/${slug}`} className="block">
        <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-white to-paper-2">
          {p.image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={p.image} alt={p.title} loading="lazy"
              className="shot h-full w-full object-contain p-[18px] transition-transform duration-700 hover:scale-[1.06]" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-navy-2 to-navy">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-sky">{p.subcategory}</span>
            </div>
          )}
          {p.saving ? (
            <span className="absolute left-3 top-3 rounded-sm bg-blue px-2.5 py-1 text-[11px] font-bold text-navy">
              Save {gbp(p.saving)}
            </span>
          ) : null}
        </div>
        <div className="p-[18px] pb-3.5">
          <div className="mb-2 flex items-center justify-between gap-2.5">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-blue-deep">{p.brand}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] font-semibold text-muted">
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: availabilityDot(p.availabilityNormalised) }} />
              {p.availability || "Call to confirm"}
            </span>
          </div>
          <h3 className="mb-2.5 line-clamp-2 min-h-[48px] font-display text-[21px] font-medium leading-tight text-ink">
            {p.title}
          </h3>
          <p className="mb-3.5 font-mono text-[10px] tracking-[0.06em] text-ink/50">Code {p.productCode}</p>
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-[27px] font-semibold text-ink">{gbp(p.priceNow)}</span>
            {p.priceWas ? <span className="text-sm text-ink/40 line-through">{gbp(p.priceWas)}</span> : null}
          </div>
        </div>
      </Link>
      {/* min-h-11 = 44px tap targets; most of this shop's traffic is on a phone. */}
      <div className="mt-auto flex gap-2 px-[18px] pb-[18px]">
        <Link href={`/products/${slug}`}
          className="flex min-h-11 flex-1 items-center justify-center rounded-sm bg-navy px-3 text-center text-[12.5px] font-semibold tracking-[0.02em] text-paper transition-colors hover:bg-navy-2">
          View details
        </Link>
        <a href={telHref(STORE_PHONE)} aria-label={`Call to check stock for ${p.productCode}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-ink/20 px-3.5 text-[12.5px] font-semibold text-ink transition-colors hover:border-blue hover:text-blue-deep">
          <Phone size={13} strokeWidth={2.2} /> Call
        </a>
      </div>
    </div>
  );
}
