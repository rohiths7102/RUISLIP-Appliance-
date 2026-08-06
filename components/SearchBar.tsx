"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Phone, LayoutGrid, Tag, ArrowUpRight } from "lucide-react";
import { formatPrice } from "@/lib/format";

type Hit = {
  slug: string; title: string; brand: string; productCode: string;
  image: string; priceNow: number | null; poa: boolean;
};
type Sug = { kind: "category" | "brand"; name: string; href: string; count: number };

/**
 * Header search — the owner asked for the official Euronics site's format, and
 * this is the part that makes it feel alive: a debounced type-ahead dropdown of
 * department/brand shortcuts and real products (thumbnail · name · price, or
 * "Call for price" — never a number the owner withholds). One keyboard index
 * runs down the whole list: suggestions first, then products. Enter with
 * nothing highlighted, or the "See all" footer, lands on /products?q=… — the
 * same entry point the sitelinks SearchAction schema advertises to Google.
 */
export default function SearchBar({ className = "" }: { className?: string }) {
  const [v, setV] = useState("");
  const [sugs, setSugs] = useState<Sug[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const count = sugs.length + hits.length;

  // Debounced fetch; in-flight responses are aborted so a fast typist never
  // sees an earlier query's results land after a later one's.
  useEffect(() => {
    const q = v.trim();
    if (q.length < 2) { setSugs([]); setHits([]); setTotal(0); setOpen(false); return; }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
        if (!r.ok) return;
        const j = await r.json();
        setSugs(j.suggestions || []); setHits(j.items || []); setTotal(j.total || 0);
        setOpen(true); setActive(-1);
      } catch { /* aborted or offline — keep whatever is shown */ }
    }, 180);
    return () => clearTimeout(t);
  }, [v]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (href: string) => { setOpen(false); setActive(-1); router.push(href); };
  const hrefAt = (i: number) =>
    i < sugs.length ? sugs[i].href : `/products/${hits[i - sugs.length].slug}`;
  const submit = () => {
    const q = v.trim();
    if (active >= 0 && active < count) return go(hrefAt(active));
    if (q) go(`/products?q=${encodeURIComponent(q)}`);
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <form
        role="search"
        className="flex w-full items-center overflow-hidden rounded-full border border-ink/15 bg-white focus-within:border-blue"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          onFocus={() => { if (count) setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); if (count) { setOpen(true); setActive((a) => (a + 1) % count); } }
            else if (e.key === "ArrowUp") { e.preventDefault(); if (count) { setOpen(true); setActive((a) => (a <= 0 ? count - 1 : a - 1)); } }
            else if (e.key === "Escape") { setOpen(false); setActive(-1); }
          }}
          placeholder="Search 1,800+ appliances…"
          aria-label="Search products"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="header-search-listbox"
          className="min-w-0 flex-1 bg-transparent px-4 py-2 text-sm text-ink placeholder:text-muted outline-none"
        />
        <button type="submit" aria-label="Search" className="m-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-paper transition-colors hover:bg-blue">
          <Search size={15} strokeWidth={2.4} />
        </button>
      </form>

      {open && (
        <div
          id="header-search-listbox"
          role="listbox"
          aria-label="Search suggestions"
          className="absolute inset-x-0 top-[calc(100%+8px)] z-[60] overflow-hidden rounded-2xl border border-line bg-white shadow-[0_28px_64px_-20px_rgba(7,26,51,.4)]"
        >
          {count === 0 ? (
            <p className="px-4 py-3.5 text-[12.5px] text-muted">No matches — try a brand, model or product code.</p>
          ) : (
            <>
              {/* department / brand shortcuts — straight to a browsable page */}
              {sugs.map((s, i) => (
                <button
                  key={s.href}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(s.href)}
                  className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${i === active ? "bg-paper-2" : "bg-white"}`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue/10">
                    {s.kind === "category"
                      ? <LayoutGrid size={13.5} className="text-blue-deep" aria-hidden />
                      : <Tag size={13.5} className="text-blue-deep" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold leading-tight text-ink">{s.name}</span>
                    <span className="mt-0.5 block font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
                      {s.kind === "category" ? "Department" : "Brand"} · {s.count.toLocaleString("en-GB")} models
                    </span>
                  </span>
                  <ArrowUpRight size={14} className="shrink-0 text-muted" aria-hidden />
                </button>
              ))}
              {sugs.length > 0 && hits.length > 0 && <div className="mx-3.5 h-px bg-line" aria-hidden />}

              {hits.map((h, i) => {
                const idx = sugs.length + i;
                return (
                  <button
                    key={h.slug}
                    type="button"
                    role="option"
                    aria-selected={idx === active}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => go(`/products/${h.slug}`)}
                    className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${idx === active ? "bg-paper-2" : "bg-white"}`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white">
                      {h.image ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={h.image} alt="" loading="lazy" className="max-h-9 max-w-9 object-contain" />
                      ) : (
                        <Search size={14} className="text-muted" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium leading-tight text-ink">{h.title}</span>
                      <span className="mt-0.5 block font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
                        {h.brand} · {h.productCode}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      {h.poa || h.priceNow === null ? (
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-blue-deep">
                          <Phone size={11} strokeWidth={2.4} aria-hidden /> Call for price
                        </span>
                      ) : (
                        <span className="text-[13.5px] font-semibold tabular-nums text-ink">{formatPrice(h.priceNow)}</span>
                      )}
                    </span>
                  </button>
                );
              })}
              {hits.length > 0 && (
                <button
                  type="button"
                  onClick={() => go(`/products?q=${encodeURIComponent(v.trim())}`)}
                  className="block w-full border-t border-line bg-paper-2/60 px-4 py-2.5 text-center text-[12.5px] font-semibold text-blue-deep transition-colors hover:bg-paper-2"
                >
                  See all {total.toLocaleString("en-GB")} result{total === 1 ? "" : "s"} →
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
