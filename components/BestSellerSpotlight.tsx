"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import PriceMatchPromise from "@/components/PriceMatchPromise";

/**
 * The right-hand rail beside "Shop by type" on wide screens: one of Sachin's
 * best sellers at a time, crossfading every few seconds — photo, name, live
 * price — with the Price Match Promise under it. Pauses while pointed at;
 * still for reduced motion.
 */
export type Spotlight = { slug: string; code: string; brand: string; title: string; price: string; image: string };

export default function BestSellerSpotlight({ picks }: { picks: Spotlight[] }) {
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held || picks.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % picks.length), 4500);
    return () => clearInterval(t);
  }, [held, picks.length]);
  if (!picks.length) return null;
  const p = picks[i];
  return (
    <div onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} className="border border-line bg-white">
      <p className="bg-[#1b3e7b] px-3 py-2 text-center text-[15px] font-light text-white">Best seller</p>
      <Link key={p.code} href={`/products/${p.slug}`} className="spot-in block px-4 pb-3 pt-4 hover:[&_img]:scale-[1.04]">
        <span className="block aspect-square">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.image} alt={`${p.brand} ${p.title}`} className="h-full w-full object-contain transition-transform duration-500" />
        </span>
        <span className="mt-3 block text-[12px] font-semibold uppercase tracking-wide text-muted">{p.brand}</span>
        <span className="mt-0.5 block text-[14px] font-medium leading-snug text-ink">{p.title}</span>
        <span className="mt-2 block text-[22px] font-bold text-ink">{p.price}</span>
      </Link>
      <div className="border-t border-line px-4 py-3">
        <PriceMatchPromise code={p.code} title={p.title} compact />
      </div>
      {picks.length > 1 && (
        <div className="flex justify-center gap-1.5 pb-3" aria-hidden>
          {picks.map((x, n) => <span key={x.code} className={`h-1.5 rounded-full transition-all ${n === i ? "w-5 bg-[#1b3e7b]" : "w-1.5 bg-line"}`} />)}
        </div>
      )}
    </div>
  );
}
