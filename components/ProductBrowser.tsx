"use client";
import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { Product } from "@/lib/types";
import ProductCard from "./ProductCard";

/**
 * Card-only slice of Product — the grid never reads specs/description/gallery,
 * which are ~90% of the serialised payload. Full Product still satisfies it,
 * so category/brand pages can keep passing whole records.
 */
export type ProductCardItem = Pick<Product,
  "id" | "newSlug" | "title" | "brand" | "productCode" | "category" | "subcategory" |
  "image" | "priceNow" | "priceWas" | "saving" | "availability" | "availabilityNormalised">;

const PER_PAGE = 24;

/**
 * The catalogue is ~1,600 products, so results are always paginated — rendering
 * every card at once locks up the browser on mobile.
 */
export default function ProductBrowser({
  items,
  brands,
  categories = [],
  initialCategory = "all",
  initialQuery = "",
}: {
  items: ProductCardItem[];
  brands: string[];
  categories?: string[];
  initialCategory?: string;
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [brand, setBrand] = useState("all");
  const [cat, setCat] = useState(initialCategory);
  const [avail, setAvail] = useState("all");
  const [sort, setSort] = useState("featured");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = items.filter((p) => {
      if (needle && !`${p.title} ${p.brand} ${p.productCode}`.toLowerCase().includes(needle)) return false;
      if (brand !== "all" && p.brand !== brand) return false;
      if (cat !== "all" && p.category !== cat && p.subcategory !== cat) return false;
      if (avail !== "all" && p.availabilityNormalised !== avail) return false;
      return true;
    });
    if (sort === "price-asc") list = [...list].sort((a, b) => (a.priceNow ?? 1e9) - (b.priceNow ?? 1e9));
    else if (sort === "price-desc") list = [...list].sort((a, b) => (b.priceNow ?? -1) - (a.priceNow ?? -1));
    else if (sort === "brand") list = [...list].sort((a, b) => a.brand.localeCompare(b.brand) || a.title.localeCompare(b.title));
    else list = [...list].sort((a, b) => Number(!!b.image) - Number(!!a.image) || Number(b.priceNow !== null) - Number(a.priceNow !== null));
    return list;
  }, [items, q, brand, cat, avail, sort]);

  // Any filter change invalidates the current page number.
  useEffect(() => { setPage(1); }, [q, brand, cat, avail, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  const dirty = q !== "" || brand !== "all" || cat !== initialCategory || avail !== "all";

  const select = "rounded-sm border border-ink/15 bg-white px-3 py-2.5 text-[13px] outline-none focus:border-blue";

  return (
    <div>
      <div className="rounded-[4px] border border-ink/10 bg-card p-5">
        <div className="relative mb-3">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, brand or product code…"
            aria-label="Search products"
            className="w-full rounded-sm border border-ink/15 bg-white py-2.5 pl-10 pr-3 text-[13px] outline-none focus:border-blue"
          />
        </div>
        <div className="flex flex-wrap gap-2.5">
          {categories.length > 0 && (
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category" className={select}>
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand" className={select}>
            <option value="all">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={avail} onChange={(e) => setAvail(e.target.value)} aria-label="Availability" className={select}>
            <option value="all">Any availability</option>
            <option value="in_stock">In stock</option>
            <option value="limited">Limited availability</option>
            <option value="call_to_confirm">Call to confirm</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" className={select}>
            <option value="featured">Featured</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="brand">Brand A–Z</option>
          </select>
          {dirty && (
            <button
              onClick={() => { setQ(""); setBrand("all"); setCat(initialCategory); setAvail("all"); }}
              className="inline-flex items-center gap-1.5 rounded-sm px-3 py-2.5 text-[12px] font-semibold text-blue-deep hover:underline"
            >
              <X size={13} /> Clear filters
            </button>
          )}
        </div>
      </div>

      <p className="mt-5 text-[13.5px] text-muted">
        <strong className="text-ink">{filtered.length.toLocaleString("en-GB")}</strong>{" "}
        {filtered.length === 1 ? "appliance" : "appliances"}
        {pages > 1 && <span className="text-ink/45"> · page {current} of {pages}</span>}
      </p>

      {shown.length > 0 ? (
        <div className="mt-5 grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {/* safe cast: ProductCard only reads ProductCardItem fields */}
          {shown.map((p) => <ProductCard key={p.id} p={p as Product} />)}
        </div>
      ) : (
        <div className="mt-8 rounded-[4px] border border-dashed border-ink/20 p-20 text-center">
          <p className="mb-2 font-display text-[26px]">Nothing matches those filters</p>
          <p className="text-sm text-muted">Try widening your search, or call us — we carry more than we can list online.</p>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-12 flex flex-wrap items-center justify-center gap-2" aria-label="Pagination">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={current === 1}
            className="min-h-11 rounded-sm border border-ink/15 bg-white px-4 text-[12.5px] font-semibold disabled:opacity-40"
          >
            Previous
          </button>
          {pageWindow(current, pages).map((n, i) =>
            n === "…" ? (
              <span key={`gap${i}`} className="px-1.5 text-ink/40">…</span>
            ) : (
              <button
                key={n}
                onClick={() => setPage(n as number)}
                aria-current={n === current ? "page" : undefined}
                className={`min-h-11 min-w-11 rounded-sm px-3 font-mono text-[12.5px] font-bold ${
                  n === current ? "bg-navy text-sky" : "border border-ink/15 bg-white hover:border-blue"
                }`}
              >
                {n}
              </button>
            )
          )}
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={current === pages}
            className="min-h-11 rounded-sm border border-ink/15 bg-white px-4 text-[12.5px] font-semibold disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

/** 1 … 4 5 [6] 7 8 … 67 */
function pageWindow(current: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const from = Math.max(2, current - 2);
  const to = Math.min(pages - 1, current + 2);
  if (from > 2) out.push("…");
  for (let i = from; i <= to; i++) out.push(i);
  if (to < pages - 1) out.push("…");
  out.push(pages);
  return out;
}
