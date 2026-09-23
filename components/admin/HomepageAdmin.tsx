"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, Eye, EyeOff, ExternalLink, ImageOff, Plus, RotateCcw, Search, Sparkles, Star, Trash2, X,
} from "lucide-react";
import { Badge, Button, Card, Notice } from "@/components/admin/ui";

/**
 * Admin → Homepage. The two moving parts of the front page, in the order a
 * visitor sees them: the big slideshow at the top, then the featured-products
 * row. Nothing is live until "Save"; the bar at the bottom says so.
 *
 * Every product is shown with its photo, so the owner picks by eye, not by
 * model code — and anything the homepage would quietly skip (hidden, no photo,
 * not in the catalogue) is flagged on the spot, with the reason.
 */
type Slide = { id: string; enabled: boolean; brand: string; line: string; sub: string; codes: string[] };
type Featured = { code: string; bestSeller: boolean };
type Prod = { id: string; productCode: string; title: string; brand: string; subcategory: string; mainImage: string; priceNow: number | null; isVisible: boolean; slug: string };
type State = { slides: Slide[]; featured: Featured[] };

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const key = (c: string) => c.toUpperCase();
const move = <T,>(list: T[], i: number, d: number) => {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

/** Why the homepage would skip this product, or null if it will show. */
function problem(p: Prod | undefined): string | null {
  if (!p) return "Not in the catalogue — check the model code";
  if (!p.isVisible) return "Hidden from the website, so it won’t show";
  if (!p.mainImage) return "Has no photo, so it won’t show";
  return null;
}

export default function HomepageAdmin() {
  const [saved, setSaved] = useState<State | null>(null);
  const [draft, setDraft] = useState<State | null>(null);
  const [products, setProducts] = useState<Map<string, Prod>>(new Map());
  const [brands, setBrands] = useState<{ name: string; productCount: number }[]>([]);
  const [defaults, setDefaults] = useState<Slide[]>([]);
  const [shown, setShown] = useState(12);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<null | { title: string; onPick: (p: Prod) => void }>(null);
  const [tab, setTab] = useState<"slides" | "featured">("slides");

  const remember = useCallback((list: Prod[]) => {
    setProducts((m) => { const n = new Map(m); for (const p of list) n.set(key(p.productCode), p); return n; });
  }, []);

  useEffect(() => {
    fetch("/api/admin/homepage").then((r) => r.json()).then((j) => {
      if (j.error) { setErr(j.error); return; }
      const s = { slides: j.slides, featured: j.featured };
      setSaved(s); setDraft(s); remember(j.products); setBrands(j.brands || []);
      setDefaults(j.defaults || []); setShown(j.featuredShown || 12);
    }).catch(() => setErr("Could not load the homepage settings. Is the database running?"));
  }, [remember]);

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!draft) return err ? <Notice tone="danger">{err}</Notice> : <p className="py-10 text-center text-sm text-muted">Loading the homepage…</p>;

  const prod = (c: string) => products.get(key(c));
  const setSlides = (f: (s: Slide[]) => Slide[]) => { setMsg(""); setDraft((d) => d && { ...d, slides: f(d.slides) }); };
  const setFeatured = (f: (s: Featured[]) => Featured[]) => { setMsg(""); setDraft((d) => d && { ...d, featured: f(d.featured) }); };
  const patchSlide = (i: number, p: Partial<Slide>) => setSlides((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));

  // What the homepage will really do with the featured list: skip the ones it
  // can't show, and stop after `shown`.
  let live = 0;
  const featuredFate = draft.featured.map((f) => {
    const why = problem(prod(f.code));
    if (why) return { live: false, why };
    live++;
    return live <= shown ? { live: true, why: null } : { live: false, why: `Waiting — only the first ${shown} are shown` };
  });
  const liveSlides = draft.slides.filter((s) => s.enabled && s.codes.some((c) => !problem(prod(c)))).length;

  async function suggest(i: number) {
    const brand = draft!.slides[i].brand;
    setErr("");
    const r = await fetch(`/api/admin/homepage?suggest=${encodeURIComponent(brand)}`).then((x) => x.json()).catch(() => null);
    if (!r?.codes?.length) { setErr(`No ${brand || ""} products with a photo and a price to suggest.`); return; }
    const found = await Promise.all(r.codes.map((c: string) => lookup(c)));
    remember(found.filter(Boolean) as Prod[]);
    patchSlide(i, { codes: r.codes });
  }

  async function save() {
    setSaving(true); setErr(""); setMsg("");
    const r = await fetch("/api/admin/homepage", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setSaving(false);
    if (!r || !r.ok) { setErr(j.error || "Could not save. Try again."); return; }
    const s = { slides: j.slides, featured: j.featured };
    setSaved(s); setDraft(s);
    setMsg("Saved — the homepage is updated. Open it to have a look.");
  }

  function addSlide() {
    setSlides((s) => [...s, { id: `slide-${Date.now()}`, enabled: true, brand: brands[0]?.name || "", line: "", sub: "", codes: [] }]);
    setTab("slides");
  }

  function addFeatured(p: Prod) {
    remember([p]);
    if (draft!.featured.some((f) => key(f.code) === key(p.productCode))) { setErr(`${p.productCode} is already in the row.`); return; }
    setErr("");
    setFeatured((f) => [...f, { code: p.productCode, bestSeller: false }]);
  }

  const brandOptions = brands.filter((b) => b.productCount > 0);

  return (
    <div className="pb-28">
      {/* ------------------------------------------------ explainer + tabs */}
      <Card className="p-5">
        <p className="text-sm text-ink/80">
          Choose what the front page shows. The <b>slideshow</b> is the big banner at the very top; the <b>featured products</b> are
          the row of products under it. Change anything, then press <b>Save</b> — nothing goes live until you do.
        </p>
        <div className="mt-4 flex flex-wrap gap-2" role="tablist">
          {([["slides", `Slideshow at the top · ${liveSlides} showing`], ["featured", `Featured products · ${Math.min(live, shown)} showing`]] as const).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`rounded-full px-4 py-2 text-sm font-medium ${tab === t ? "bg-navy text-paper" : "border border-navy/20 text-ink hover:border-blue"}`}>
              {label}
            </button>
          ))}
        </div>
      </Card>

      {err && <Notice tone="danger" className="mt-4">{err}</Notice>}
      {msg && <Notice tone="success" className="mt-4">{msg} <a href="/" target="_blank" rel="noreferrer" className="ml-1 underline">Open the homepage ↗</a></Notice>}

      {/* ------------------------------------------------------ slideshow */}
      {tab === "slides" && (
        <section className="mt-5 space-y-4" aria-label="Slideshow">
          {draft.slides.map((s, i) => {
            const usable = s.codes.filter((c) => !problem(prod(c)));
            const off = !s.enabled || !usable.length;
            return (
              <Card key={s.id} className={`overflow-hidden ${!s.enabled ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper-2/60 px-4 py-2.5">
                  <span className="font-mono text-xs text-muted">Slide {i + 1}</span>
                  {off ? <Badge tone="neutral">{!s.enabled ? "Hidden" : "Won’t show — no usable product"}</Badge> : <Badge tone="success">Showing</Badge>}
                  <div className="ml-auto flex items-center gap-1">
                    <Button small variant="ghost" onClick={() => patchSlide(i, { enabled: !s.enabled })}>
                      {s.enabled ? <><EyeOff size={14} className="mr-1 inline" />Hide</> : <><Eye size={14} className="mr-1 inline" />Show</>}
                    </Button>
                    <IconBtn label="Move up" onClick={() => setSlides((l) => move(l, i, -1))} disabled={i === 0}><ArrowUp size={15} /></IconBtn>
                    <IconBtn label="Move down" onClick={() => setSlides((l) => move(l, i, 1))} disabled={i === draft.slides.length - 1}><ArrowDown size={15} /></IconBtn>
                    <IconBtn label="Delete slide" danger onClick={() => { if (confirm(`Delete slide ${i + 1}${s.brand ? ` (${s.brand})` : ""}?`)) setSlides((l) => l.filter((_, j) => j !== i)); }}><Trash2 size={15} /></IconBtn>
                  </div>
                </div>

                <div className="grid gap-5 p-4 lg:grid-cols-[1fr_1.1fr]">
                  <div className="space-y-3">
                    <label className="block text-xs font-medium text-ink/70">
                      What is this slide for?
                      <select value={s.brand} onChange={(e) => {
                          const b = e.target.value;
                          // Keep the stock headline in step with the brand; never touch one he wrote.
                          const stock = !s.line || s.line === (s.brand ? `The ${s.brand} range` : "Top brand, hand-picked appliances");
                          patchSlide(i, { brand: b, ...(stock ? { line: b ? `The ${b} range` : "Top brand, hand-picked appliances" } : {}) });
                        }}
                        className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
                        <option value="">The shop — Euronics Ruislip (button: Browse appliances)</option>
                        {brandOptions.map((b) => <option key={b.name} value={b.name}>{b.name} — button: Shop all {b.name} ({b.productCount})</option>)}
                        {s.brand && !brandOptions.some((b) => b.name === s.brand) && <option value={s.brand}>{s.brand}</option>}
                      </select>
                    </label>
                    <label className="block text-xs font-medium text-ink/70">
                      Headline <span className="font-normal text-muted">({s.line.length}/80)</span>
                      <input value={s.line} maxLength={80} onChange={(e) => patchSlide(i, { line: e.target.value })}
                        placeholder={s.brand ? `The ${s.brand} range` : "Top brand, hand-picked appliances"}
                        className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
                    </label>
                    <label className="block text-xs font-medium text-ink/70">
                      Short line under it <span className="font-normal text-muted">({s.sub.length}/220)</span>
                      <textarea value={s.sub} maxLength={220} rows={2} onChange={(e) => patchSlide(i, { sub: e.target.value })}
                        placeholder="e.g. Delivered in our own van and fitted by our own team."
                        className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
                    </label>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-ink/70">Products in the picture <span className="font-normal text-muted">(the first one is the big one)</span></p>
                      <Button small variant="ghost" onClick={() => suggest(i)} title="Fill with three good products for this brand">
                        <Sparkles size={13} className="mr-1 inline" />Pick for me
                      </Button>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {[0, 1, 2].map((slot) => {
                        const code = s.codes[slot];
                        const p = code ? prod(code) : undefined;
                        const choose = () => setPicker({
                          title: `Slide ${i + 1}: ${slot === 0 ? "the main product" : `product ${slot + 1}`}`,
                          onPick: (np) => { remember([np]); const codes = [...s.codes]; codes[slot] = np.productCode; patchSlide(i, { codes: codes.filter(Boolean) }); },
                        });
                        if (!code) return (
                          <button key={slot} onClick={choose} disabled={slot > s.codes.length}
                            className="flex aspect-square flex-col items-center justify-center rounded-xl border-2 border-dashed border-line text-xs text-muted hover:border-blue hover:text-blue-deep disabled:opacity-40">
                            <Plus size={18} />{slot === 0 ? "Main product" : "Add product"}
                          </button>
                        );
                        return (
                          <ProductTile key={slot} code={code} p={p} big={slot === 0}
                            onChange={choose}
                            onRemove={() => patchSlide(i, { codes: s.codes.filter((_, j) => j !== slot) })}
                            onLeft={slot > 0 ? () => patchSlide(i, { codes: move(s.codes, slot, -1) }) : undefined} />
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={addSlide} disabled={draft.slides.length >= 12}><Plus size={14} className="mr-1 inline" />Add a slide</Button>
            {defaults.length > 0 && (
              <Button variant="ghost" onClick={() => { if (confirm("Put the slideshow back to the original eight slides? (Not saved until you press Save.)")) { setSlides(() => defaults); } }}>
                <RotateCcw size={14} className="mr-1 inline" />Back to the original slides
              </Button>
            )}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------ featured */}
      {tab === "featured" && (
        <section className="mt-5" aria-label="Featured products">
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink/80">
                The homepage shows the <b>first {shown}</b> that can be shown, in this order. Tap <Star size={13} className="inline text-warning" /> to put a
                “Best seller” tag on one. You can also tick <i>Featured</i> on any product in Products.
              </p>
              <Button small onClick={() => setPicker({ title: "Add to featured products", onPick: addFeatured })}>
                <Plus size={14} className="mr-1 inline" />Add a product
              </Button>
            </div>
          </Card>

          {!draft.featured.length && <p className="mt-6 text-center text-sm text-muted">No featured products — the row is hidden from the homepage until you add some.</p>}

          <ol className="mt-3 space-y-2">
            {draft.featured.map((f, i) => {
              const p = prod(f.code);
              const fate = featuredFate[i];
              const firstWaiting = !fate.live && fate.why?.startsWith("Waiting") && !featuredFate.slice(0, i).some((x) => x.why?.startsWith("Waiting"));
              return (
                <li key={f.code}>
                  {firstWaiting && (
                    <div className="my-3 flex items-center gap-3 text-xs font-medium text-muted">
                      <span className="h-px flex-1 bg-line" />Below this line: saved, but not shown until you move them up<span className="h-px flex-1 bg-line" />
                    </div>
                  )}
                  <Card className={`flex items-center gap-3 p-2.5 ${fate.live ? "" : "opacity-60"}`}>
                    <span className="w-6 text-center font-mono text-xs text-muted">{i + 1}</span>
                    <Thumb p={p} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p ? p.title : f.code}</p>
                      <p className="text-xs text-muted">
                        <span className="font-mono">{f.code}</span>{p ? ` · ${p.brand}` : ""}{p?.priceNow != null ? ` · ${gbp(p.priceNow)}` : p ? " · Call for price" : ""}
                      </p>
                      {fate.why && <p className={`text-xs ${problem(p) ? "text-danger" : "text-muted"}`}>{fate.why}</p>}
                    </div>
                    <button onClick={() => setFeatured((l) => l.map((x, j) => (j === i ? { ...x, bestSeller: !x.bestSeller } : x)))}
                      aria-pressed={f.bestSeller} aria-label={`Best seller tag for ${f.code}`}
                      className={`hidden items-center gap-1 rounded-full px-2.5 py-1 text-xs sm:inline-flex ${f.bestSeller ? "bg-warning-soft text-warning" : "text-muted hover:bg-paper-2"}`}>
                      <Star size={13} fill={f.bestSeller ? "currentColor" : "none"} />{f.bestSeller ? "Best seller" : "Tag"}
                    </button>
                    <IconBtn label="Move up" onClick={() => setFeatured((l) => move(l, i, -1))} disabled={i === 0}><ArrowUp size={15} /></IconBtn>
                    <IconBtn label="Move down" onClick={() => setFeatured((l) => move(l, i, 1))} disabled={i === draft.featured.length - 1}><ArrowDown size={15} /></IconBtn>
                    <IconBtn label={`Remove ${f.code}`} danger onClick={() => setFeatured((l) => l.filter((_, j) => j !== i))}><X size={15} /></IconBtn>
                  </Card>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* ------------------------------------------------------- save bar */}
      <div className={`fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-4 py-3 backdrop-blur transition-transform md:left-[236px] ${dirty || saving ? "translate-y-0" : "translate-y-full"}`}>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">You have changes that aren’t live yet.</p>
          <div className="flex gap-2">
            <Button variant="secondary" small onClick={() => { setDraft(saved); setErr(""); }} disabled={saving}>Undo changes</Button>
            <Button small onClick={save} disabled={saving}>{saving ? "Saving…" : "Save — put it live"}</Button>
          </div>
        </div>
      </div>
      {!dirty && !saving && (
        <p className="mt-6 text-center text-xs text-muted">
          <a href="/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-blue-deep">Open the homepage <ExternalLink size={11} /></a>
        </p>
      )}

      {picker && <ProductPicker title={picker.title} onClose={() => setPicker(null)} onPick={(p) => { picker.onPick(p); setPicker(null); }} />}
    </div>
  );
}

/* ------------------------------------------------------------------ bits */

async function lookup(code: string): Promise<Prod | null> {
  const j = await fetch(`/api/admin/products?q=${encodeURIComponent(code)}&take=5`).then((r) => r.json()).catch(() => null);
  return (j?.rows || []).find((p: Prod) => key(p.productCode) === key(code)) || null;
}

function IconBtn({ label, danger, children, ...rest }: { label: string; danger?: boolean; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} aria-label={label} title={label}
      className={`rounded-lg p-1.5 text-ink/60 disabled:opacity-25 ${danger ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-paper-2 hover:text-ink"}`}>
      {children}
    </button>
  );
}

function Thumb({ p, size = 48 }: { p?: Prod; size?: number }) {
  return p?.mainImage
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={p.mainImage} alt="" width={size} height={size} className="shrink-0 rounded-lg bg-white object-contain" style={{ width: size, height: size }} />
    : <span className="flex shrink-0 items-center justify-center rounded-lg bg-paper-2 text-muted" style={{ width: size, height: size }}><ImageOff size={16} /></span>;
}

function ProductTile({ code, p, big, onChange, onRemove, onLeft }: {
  code: string; p?: Prod; big: boolean; onChange: () => void; onRemove: () => void; onLeft?: () => void;
}) {
  const why = problem(p);
  return (
    <div className={`group relative flex flex-col rounded-xl border p-1.5 ${why ? "border-danger/40 bg-danger-soft/40" : big ? "border-blue/40" : "border-line"}`}>
      <button onClick={onChange} className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-white" title="Change product">
        {p?.mainImage
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={p.mainImage} alt="" className="h-full w-full object-contain" />
          : <ImageOff size={20} className="text-muted" />}
      </button>
      <p className="mt-1 truncate font-mono text-[10.5px]" title={p?.title}>{code}</p>
      <p className="truncate text-[11px] text-muted">{p?.priceNow != null ? gbp(p.priceNow) : p ? "Call for price" : ""}</p>
      {why && <p className="text-[10.5px] leading-tight text-danger">{why}</p>}
      {big && <span className="absolute left-2 top-2 rounded bg-blue px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-white">Main</span>}
      <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
        {onLeft && <button onClick={onLeft} aria-label="Make this the main product" title="Move left" className="rounded bg-white/90 p-1 text-ink/70 shadow hover:text-ink"><ArrowUp size={12} className="-rotate-90" /></button>}
        <button onClick={onRemove} aria-label={`Remove ${code}`} className="rounded bg-white/90 p-1 text-ink/70 shadow hover:text-danger"><X size={12} /></button>
      </div>
    </div>
  );
}

function ProductPicker({ title, onClose, onPick }: { title: string; onClose: () => void; onPick: (p: Prod) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Prod[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      const j = await fetch(`/api/admin/products?q=${encodeURIComponent(q.trim())}&take=24`).then((r) => r.json()).catch(() => null);
      setRows(j?.rows || []); setBusy(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1.5 text-ink/60 hover:text-ink"><X size={18} /></button>
        </div>
        <div className="relative mt-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by model code, brand or name — e.g. “bosch dishwasher” or WGH254A0GB"
            className="w-full rounded-lg border border-line py-2.5 pl-9 pr-3 text-sm" />
        </div>
        <div className="mt-3 max-h-[60vh] overflow-y-auto">
          {q.trim().length < 2 && <p className="py-8 text-center text-sm text-muted">Type at least two letters to search.</p>}
          {q.trim().length >= 2 && !busy && !rows.length && <p className="py-8 text-center text-sm text-muted">Nothing matches “{q}”.</p>}
          <ul className="divide-y divide-line">
            {rows.map((p) => {
              const why = problem(p);
              return (
                <li key={p.id}>
                  <button onClick={() => onPick(p)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-paper-2">
                    <Thumb p={p} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.title}</span>
                      <span className="block text-xs text-muted"><span className="font-mono">{p.productCode}</span> · {p.brand}{p.priceNow != null ? ` · ${gbp(p.priceNow)}` : " · Call for price"}</span>
                      {why && <span className="block text-xs text-danger">{why}</span>}
                    </span>
                    <span className="text-xs font-medium text-blue-deep">Choose</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
