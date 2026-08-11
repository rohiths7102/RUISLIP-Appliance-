"use client";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";

/**
 * The department fly-out under the blue nav — the pattern the owner liked from
 * the DB Domestics reference: a full-width panel with the department's
 * sub-categories down a left rail, photographed category tiles in the middle,
 * and the shop's main brands on the right. Rebuilt in this site's own language
 * (paper panel, mono captions, navy) rather than copying the reference's look.
 *
 * Data is the same vocabulary as everywhere else: sub-categories are Category
 * rows (their /categories/<id> pages already exist), brands link to their
 * /brands/<slug> pages, and the counts are the live productCount the admin
 * keeps true. Nothing here invents a second taxonomy.
 */

export interface NavSub { id: string; name: string; image: string; count: number }
export interface NavDept { id: string; name: string; subs: NavSub[] }
export interface NavBrand { slug: string; name: string }
export interface NavData { departments: NavDept[]; brands: NavBrand[] }

export default function MegaMenu({ dept, brands }: { dept: NavDept; brands: NavBrand[] }) {
  // Tiles carry the photographs; the rail carries the full list. Six tiles keeps
  // the panel one row deep for every current department.
  const tiles = dept.subs.filter((s) => s.image).slice(0, 6);
  return (
    <div className="absolute inset-x-0 top-full z-50 border-b border-line bg-paper shadow-[0_18px_40px_-18px_rgba(10,20,50,0.35)]">
      <div className="container-x grid grid-cols-[200px_1fr] gap-8 py-7 xl:grid-cols-[200px_1fr_210px]">
        {/* ---- rail: every sub-category, then the whole department ---- */}
        <div className="border-r border-line pr-6">
          <p className="mb-3 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted">{dept.name}</p>
          <ul className="flex flex-col">
            {dept.subs.map((s) => (
              <li key={s.id}>
                <Link href={`/categories/${s.id}`}
                  className="group flex items-baseline justify-between gap-2 py-[7px] text-[13.5px] font-medium text-ink transition-colors hover:text-blue-deep">
                  <span className="group-hover:underline group-hover:underline-offset-4">{s.name}</span>
                  <span className="font-mono text-[9.5px] text-muted">{s.count}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href={`/categories/${dept.id}`}
            className="group mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-blue-deep">
            View all {dept.name}
            <ArrowRight size={13} className="transition-transform duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] group-hover:translate-x-[3px]" />
          </Link>
        </div>

        {/* ---- photographed tiles ---- */}
        <div className={`grid gap-4 ${tiles.length <= 3 ? "grid-cols-3" : "grid-cols-3 xl:grid-cols-6"}`}>
          {tiles.map((s) => (
            <Link key={s.id} href={`/categories/${s.id}`} className="card-lift group flex flex-col overflow-hidden rounded-[5px] border border-ink/10 bg-card">
              <span className="relative block aspect-square overflow-hidden bg-gradient-to-br from-white to-paper-2">
                <Image src={s.image} alt="" fill sizes="160px"
                  className="object-contain p-3.5 transition-transform duration-500 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] group-hover:scale-[1.05]" />
              </span>
              <span className="flex flex-1 flex-col gap-0.5 px-3 py-2.5">
                <span className="text-[12.5px] font-semibold leading-tight text-ink">{s.name}</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">{s.count} models</span>
              </span>
            </Link>
          ))}
          {/* A department whose subs are unphotographed still deserves a panel,
              not an empty middle — fall back to quiet navy tiles. */}
          {!tiles.length && dept.subs.slice(0, 6).map((s) => (
            <Link key={s.id} href={`/categories/${s.id}`}
              className="card-lift group flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[5px] bg-gradient-to-br from-navy-2 to-navy p-3 text-center">
              <span className="text-[13px] font-semibold leading-tight text-white">{s.name}</span>
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-sky">{s.count} models</span>
            </Link>
          ))}
        </div>

        {/* ---- the shop's main brands (owner-pinned order) ---- */}
        <div className="hidden border-l border-line pl-6 xl:block">
          <p className="mb-3 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted">Popular brands</p>
          <ul className="grid grid-cols-2 gap-x-4">
            {brands.map((b) => (
              <li key={b.slug}>
                <Link href={`/brands/${b.slug}`}
                  className="block py-[6px] text-[13px] font-medium text-ink transition-colors hover:text-blue-deep hover:underline hover:underline-offset-4">
                  {b.name}
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/brands"
            className="group mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-blue-deep">
            All brands
            <ArrowRight size={13} className="transition-transform duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] group-hover:translate-x-[3px]" />
          </Link>
        </div>
      </div>
    </div>
  );
}
