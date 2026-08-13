"use client";
import Link from "next/link";
import Image from "next/image";
import { Phone } from "lucide-react";
import type { Product } from "@/lib/types";
import { slugOf } from "@/lib/select";
import { gbp, availabilityDot, telHref, STORE_PHONE } from "@/lib/format";
import { energyClassOf, energyTone, type EnergyClass } from "@/lib/energy";

const TONE_BG = { success: "bg-success", warning: "bg-warning", danger: "bg-danger" } as const;

export default function ProductCard({ p, energyClass }: { p: Product; energyClass?: EnergyClass | null }) {
  const slug = slugOf(p);
  // Grid DTOs pass the class pre-computed; full-Product callers fall back to specs.
  const energy = energyClass ?? energyClassOf(p.specifications);
  // Owner-flagged category (accessories at cost price, coffee machines): no price
  // on the card at all — "call for price" replaces it, and no save badge either.
  const poa = (p as { poa?: boolean }).poa === true;
  const save = !poa && p.saving !== null && p.priceWas !== null && p.priceNow !== null && p.priceWas > p.priceNow
    ? Math.round(p.saving) : 0;
  return (
    <div className="card-lift group flex h-full flex-col overflow-hidden border border-line bg-white">
      <Link href={`/products/${slug}`} className="block">
        <div className="relative aspect-square overflow-hidden bg-white">
          {p.image ? (
            // fill + object-contain inside the square wrapper; the wrapper's paper
            // gradient shows as a quiet tile until onLoad flips data-loaded → fade in.
            <Image src={p.image} alt={p.title} fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 300px"
              onLoad={(e) => { e.currentTarget.dataset.loaded = "true"; }}
              className="shot object-contain p-[18px] opacity-0 transition-[opacity,transform] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] data-[loaded]:opacity-100 group-hover:scale-[1.03]" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-navy-2 to-navy">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-sky">{p.subcategory}</span>
            </div>
          )}
          {save > 0 ? (
            <span className="absolute left-3 top-3 rounded-sm bg-danger-soft px-2.5 py-1 text-[11px] font-bold text-danger">
              Save £{save.toLocaleString("en-GB")}
            </span>
          ) : null}
          {energy ? (
            // EU-label indicator arrow: rounded rect with a left-pointing tip.
            <span aria-label={`Energy rating ${energy}`}
              className={`absolute bottom-3 left-3 rounded-r-sm py-1 pl-3.5 pr-2 text-[11px] font-bold leading-none text-white ${TONE_BG[energyTone(energy)]} [clip-path:polygon(0_50%,9px_0,100%_0,100%_100%,9px_100%)]`}>
              {energy}
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
          <h3 className="mb-2.5 line-clamp-2 min-h-[42px] text-[15px] font-semibold leading-snug text-ink transition-colors duration-300 ease-[cubic-bezier(.2,.8,.2,1)] group-hover:text-blue">
            {p.title}
          </h3>
          <p className="mb-3.5 font-mono text-[10px] tracking-[0.06em] text-ink/70">Code {p.productCode}</p>
          {poa ? (
            <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-blue">
              <Phone size={13} strokeWidth={2.4} /> Call for price
            </span>
          ) : (
            <div className="flex items-baseline gap-2.5">
              <span className="text-[21px] font-bold tracking-tight text-ink">{gbp(p.priceNow)}</span>
              {p.priceWas ? <span className="text-sm text-ink/70 line-through">{gbp(p.priceWas)}</span> : null}
            </div>
          )}
        </div>
      </Link>
      {/* min-h-11 = 44px tap targets; most of this shop's traffic is on a phone.
          Green marks the action, phone-first: Call is solid, details is quiet. */}
      <div className="mt-auto flex gap-2 px-[18px] pb-[18px]">
        <Link href={`/products/${slug}`}
          className="flex min-h-11 flex-1 items-center justify-center border border-blue/30 px-3 text-center text-[12.5px] font-semibold tracking-[0.02em] text-blue transition-colors hover:border-blue hover:bg-blue hover:text-white">
          View details
        </Link>
        <a href={telHref(STORE_PHONE)} aria-label={`Call to check stock for ${p.productCode}`}
          className="inline-flex min-h-11 items-center gap-1.5 bg-cta px-3.5 text-[12.5px] font-bold text-white transition-colors hover:bg-cta-deep">
          <Phone size={13} strokeWidth={2.2} /> Call
        </a>
      </div>
    </div>
  );
}
