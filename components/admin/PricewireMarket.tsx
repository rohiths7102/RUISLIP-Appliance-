"use client";
import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, Card, Notice } from "@/components/admin/ui";
import { Chart, COLOURS } from "@/components/admin/PricewireEngine";
import type { Market, MarketCard, Tag, Visitors } from "@/lib/price-watch/market";
import type { HistorySeries } from "@/lib/price-watch/pricing-rules";
import type { Effects, Verdict } from "@/lib/price-watch/effects";

/**
 * Admin → Pricewire → Market: what the price agent changed, who is looking at
 * what, how the shop sits against Ruislip Appliances, and the products worth a
 * decision — each with its photo, price graph, visitors and an AI search title.
 */
// Chart colours: two validated categorical slots (blue, orange) and a neutral, used for one job each.
const UP = "#2a78d6", DOWN = "#eb6834", NEUTRAL = "#b9b8b2", FAINT = "#e4e3df", GRID = "#e8e7e3", AXIS = "#6b7280";
const FROM: { key: keyof Visitors; label: string; colour: string }[] = [
  { key: "google", label: "Google search", colour: "#2a78d6" }, { key: "ads", label: "Google Ads", colour: "#eb6834" },
  { key: "ai", label: "AI assistants", colour: "#1baf7a" }, { key: "direct", label: "Direct", colour: "#eda100" }, { key: "other", label: "Other sites", colour: NEUTRAL },
];
const JOBS: { id: Tag; label: string; lead: string }[] = [
  { id: "promote", label: "Promote", lead: "Priced at or under Ruislip Appliances and people want them. Put these in ads, on the homepage and in posts." },
  { id: "watched", label: "Most watched", lead: "The product pages with the most visitors this week, and where those visitors came from." },
  { id: "dearer", label: "Cheaper at Ruislip", lead: "Ruislip Appliances sells these for less than we do. The ones people are looking at come first." },
  { id: "moved", label: "Price moved", lead: "The maker or site this product follows changed its price in the last 30 days." },
  { id: "seo", label: "SEO to fix", lead: "Google shows these pages low down, or people visit them and they have no search title of their own." },
];
const money = (n: number | null | undefined) => (typeof n !== "number" ? "Call" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`);
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
async function call(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  return { ok: !!r?.ok, j: r ? await r.json().catch(() => ({})) : {} };
}

/* ------------------------------------------------------------ pulse */

function Pulse({ label, value, before, note }: { label: string; value: number; before?: number; note?: string }) {
  const diff = before === undefined ? null : value - before;
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-ink">{value.toLocaleString("en-GB")}</p>
      <p className="mt-1 text-xs text-muted">{diff === null ? note : diff === 0 ? "Same as the week before" : `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff).toLocaleString("en-GB")} ${diff > 0 ? "more" : "fewer"} than the week before`}{diff !== null && note ? ` · ${note}` : ""}</p>
    </div>
  );
}

/* ------------------------------------------------------------ charts */

/** Daily bars with a hover read-out. `series` stack upward; `below` (optional) hangs under the baseline. */
function DayBars({ days, up, down, upLabel, downLabel, height = 150 }: { days: Market["daily"]; up: (d: Market["daily"][number]) => number; down?: (d: Market["daily"][number]) => number; upLabel: string; downLabel?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, L = 30, R = 6, T = 8, B = 20;
  const maxUp = Math.max(1, ...days.map(up)), maxDown = down ? Math.max(0, ...days.map(down)) : 0;
  const plot = height - T - B, zero = T + plot * (maxUp / (maxUp + maxDown || 1));
  const step = (W - L - R) / days.length, bw = Math.max(2, step - 2);
  const hUp = (v: number) => (v / maxUp) * (zero - T), hDown = (v: number) => (maxDown ? (v / maxDown) * (T + plot - zero) : 0);
  const h = hover === null ? null : days[hover];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={`${upLabel}${downLabel ? ` and ${downLabel}` : ""} by day`} onMouseLeave={() => setHover(null)}>
        <line x1={L} x2={W - R} y1={T} y2={T} stroke={GRID} /><text x={L - 5} y={T + 4} fontSize="10" textAnchor="end" fill={AXIS}>{maxUp}</text>
        {maxDown > 0 && <><line x1={L} x2={W - R} y1={T + plot} y2={T + plot} stroke={GRID} /><text x={L - 5} y={T + plot + 3} fontSize="10" textAnchor="end" fill={AXIS}>{maxDown}</text></>}
        {days.map((d, i) => {
          const x = L + i * step + 1, u = up(d), dn = down ? down(d) : 0;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={L + i * step} y={T} width={step} height={plot} fill={hover === i ? "#f3f2ee" : "transparent"} />
              {u > 0 && <rect x={x} y={zero - Math.max(2, hUp(u))} width={bw} height={Math.max(2, hUp(u))} rx={Math.min(3, bw / 2)} fill={UP} />}
              {dn > 0 && <rect x={x} y={zero + 1} width={bw} height={Math.max(2, hDown(dn))} rx={Math.min(3, bw / 2)} fill={DOWN} />}
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={zero} y2={zero} stroke="#9ca3af" />
        <text x={L} y={height - 5} fontSize="10" fill={AXIS}>{shortDay(days[0].day)}</text>
        <text x={W - R} y={height - 5} fontSize="10" textAnchor="end" fill={AXIS}>{shortDay(days[days.length - 1].day)}</text>
      </svg>
      <div className="mt-1 flex min-h-[18px] flex-wrap items-center gap-x-4 text-xs text-ink/80">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: UP }} />{upLabel}{h ? `: ${up(h)}` : ""}</span>
        {down && downLabel && <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: DOWN }} />{downLabel}{h ? `: ${down(h)}` : ""}</span>}
        {h && <span className="text-muted">{shortDay(h.day)}</span>}
      </div>
    </div>
  );
}

/** One brand's products against Ruislip Appliances, as shares of one bar. */
function Versus({ rows }: { rows: Market["versus"] }) {
  const parts = [{ k: "cheaper" as const, label: "We're cheaper", colour: UP }, { k: "same" as const, label: "Same price", colour: NEUTRAL }, { k: "dearer" as const, label: "Ruislip is cheaper", colour: DOWN }, { k: "notListed" as const, label: "Ruislip doesn't list it", colour: FAINT }];
  return (
    <div>
      <div className="space-y-3">
        {rows.map((v) => {
          const total = v.cheaper + v.same + v.dearer + v.notListed || 1;
          return (
            <div key={v.brand}>
              <div className="flex items-baseline justify-between text-sm"><span className="font-medium text-ink">{v.brand}</span>
                <span className="text-xs text-muted">{v.cheaper} cheaper · {v.same} same · {v.dearer} dearer · {v.notListed} not listed</span></div>
              <div className="mt-1 flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`${v.brand}: ${v.cheaper} cheaper than Ruislip, ${v.same} the same, ${v.dearer} dearer, ${v.notListed} not listed by Ruislip`}>
                {parts.map((p) => v[p.k] > 0 && <span key={p.k} title={`${p.label}: ${v[p.k]}`} style={{ width: `${(v[p.k] / total) * 100}%`, background: p.colour, minWidth: 3 }} />)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/80">{parts.map((p) => <span key={p.k} className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.colour }} />{p.label}</span>)}</div>
    </div>
  );
}

/** Our price over 90 days: a stepped line (a price holds until it changes), first and last labelled. */
function Spark({ points }: { points: MarketCard["spark"] }) {
  if (points.length < 2) return null;
  const t = points.map((p) => new Date(p.at).getTime()), v = points.map((p) => p.price);
  const [t0, t1] = [t[0], t[t.length - 1]], [v0, v1] = [Math.min(...v), Math.max(...v)];
  const W = 240, H = 46, x = (ms: number) => 2 + ((ms - t0) / (t1 - t0 || 1)) * (W - 8), y = (p: number) => (v1 === v0 ? H / 2 : 6 + (1 - (p - v0) / (v1 - v0)) * (H - 12));
  const path = points.map((p, i) => (i === 0 ? `M${x(t[i])},${y(p.price)}` : `H${x(t[i])}V${y(p.price)}`)).join("");
  const first = v[0], last = v[v.length - 1], moved = Math.abs(last - first) >= 0.01;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[280px]" role="img" aria-label={moved ? `Our price went from ${money(first)} to ${money(last)} in 90 days` : `Our price has been ${money(last)} for 90 days`}>
        <path d={path} fill="none" stroke={UP} strokeWidth={2} strokeLinejoin="round" />
        <circle cx={x(t1)} cy={y(last)} r={4} fill={UP} stroke="#fff" strokeWidth={2} />
      </svg>
      <p className="text-[11px] text-muted">{moved ? `Our price, 90 days: ${money(first)} → ${money(last)}` : "Our price hasn't changed in 90 days"}</p>
    </div>
  );
}

function VisitorBar({ from, total }: { from: Visitors; total: number }) {
  const parts = FROM.filter((f) => from[f.key] > 0);
  if (!total || !parts.length) return null;
  return (
    <div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`Visitors came from: ${parts.map((f) => `${f.label} ${from[f.key]}`).join(", ")}`}>
        {parts.map((f) => <span key={f.key} title={`${f.label}: ${from[f.key]}`} style={{ width: `${(from[f.key] / total) * 100}%`, background: f.colour, minWidth: 3 }} />)}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-ink/75">{parts.map((f) => <span key={f.key} className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: f.colour }} />{f.label} {from[f.key]}</span>)}</p>
    </div>
  );
}

/* ------------------------------------------------------------ product card */

const TITLE_MAX = 60, DESC_MAX = 155;
function ProductCard({ c, job }: { c: MarketCard; job: Tag }) {
  const [history, setHistory] = useState<HistorySeries[] | "loading" | null>(null);
  const [seo, setSeo] = useState<{ busy: "" | "suggest" | "save"; title: string; desc: string; queries: string[]; err: string; saved: boolean } | null>(null);
  const path = `/products/${c.slug}`;
  const gap = c.price !== null && c.ruislip !== null ? c.price - c.ruislip : null;

  async function showHistory() {
    if (history) { setHistory(null); return; }
    setHistory("loading");
    const { ok, j } = await call(`/api/admin/pricewire/insights?code=${encodeURIComponent(c.code)}`);
    setHistory(ok ? j.series : []);
  }
  async function suggest() {
    setSeo((s) => ({ busy: "suggest", title: s?.title || "", desc: s?.desc || "", queries: s?.queries || [], err: "", saved: false }));
    const { ok, j } = await call("/api/admin/seo/suggest", "POST", { kind: "product", id: c.id, path });
    setSeo(ok ? { busy: "", title: j.title, desc: j.description, queries: j.queries || [], err: "", saved: false } : { busy: "", title: "", desc: "", queries: [], err: j.error || "The AI didn't answer. Try again.", saved: false });
  }
  async function save() {
    if (!seo) return;
    setSeo({ ...seo, busy: "save", err: "" });
    const { ok, j } = await call(`/api/admin/products/${c.id}`, "PATCH", { seoTitle: seo.title.trim(), seoDescription: seo.desc.trim() });
    setSeo({ ...seo, busy: "", saved: ok, err: ok ? "" : j.error || "Could not save." });
  }

  return (
    <li className="flex flex-col rounded-xl border border-line bg-white p-4">
      <div className="flex gap-3">
        <a href={path} target="_blank" rel="noreferrer" className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {c.image ? <img src={c.image} alt="" loading="lazy" className="h-full w-full object-contain p-1" /> : <span className="text-[11px] text-muted">No photo</span>}
        </a>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{c.brand} <span className="font-mono text-ink/80">{c.code}</span></p>
          <a href={path} target="_blank" rel="noreferrer" className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-ink hover:text-blue-deep">{c.title}</a>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
            <span className="text-xl font-semibold tabular-nums text-ink">{money(c.price)}</span>
            {c.ruislip !== null && <span className="text-xs text-muted">Ruislip {money(c.ruislip)}{gap !== null && Math.abs(gap) >= 0.01 ? ` · we're ${money(Math.abs(gap))} ${gap < 0 ? "cheaper" : "dearer"}` : " · same"}</span>}
          </p>
        </div>
      </div>

      <p className="mt-3 rounded-lg bg-paper-2 px-3 py-2 text-xs leading-relaxed text-ink/85">{c.jobs[job]?.why}</p>

      <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
        {[["Views, 7 days", c.views7], ["Views, 30 days", c.views30], ["Call taps", c.calls30], ["Google clicks", c.googleClicks]].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-line px-1 py-1.5"><dd className="text-base font-semibold tabular-nums text-ink">{v}</dd><dt className="text-[10.5px] leading-tight text-muted">{k}</dt></div>
        ))}
      </dl>
      {c.googleImpressions > 0 && <p className="mt-2 text-[11px] text-muted">Google showed this page {c.googleImpressions} times, average position {c.googlePosition}.</p>}
      <div className="mt-3"><VisitorBar from={c.from} total={c.views30} /></div>
      {c.price !== null && <div className="mt-3"><Spark points={c.spark} /></div>}

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <Button small variant="secondary" onClick={showHistory}>{history ? "Hide price history" : "Price history"}</Button>
        <Button small variant="secondary" onClick={suggest} disabled={seo?.busy === "suggest"}><Sparkles className="mr-1 inline h-3.5 w-3.5" />{seo?.busy === "suggest" ? "Writing…" : seo ? "Write another" : "Write search title"}</Button>
      </div>

      {history === "loading" && <p className="mt-3 text-xs text-muted">Loading 90 days of prices…</p>}
      {Array.isArray(history) && (history.length ? (
        <div className="mt-3">
          <Chart series={history} />
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">{history.map((s, i) => <span key={s.label} className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded" style={{ background: COLOURS[i % COLOURS.length] }} />{s.label}: {money(s.points[s.points.length - 1].price)}</span>)}</div>
        </div>
      ) : <p className="mt-3 text-xs text-muted">No price changes or site reads in the last 90 days.</p>)}

      {seo && seo.busy !== "suggest" && (seo.err && !seo.title ? <Notice tone="warning" className="mt-3">{seo.err}</Notice> : (
        <div className="mt-3 space-y-2 rounded-lg border border-line p-3">
          <label className="block text-[11px] text-muted">Search title <span className={seo.title.length > TITLE_MAX ? "text-red-700" : ""}>({seo.title.length}/{TITLE_MAX})</span>
            <input className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink" value={seo.title} onChange={(e) => setSeo({ ...seo, title: e.target.value, saved: false })} /></label>
          <label className="block text-[11px] text-muted">Search description <span className={seo.desc.length > DESC_MAX ? "text-red-700" : ""}>({seo.desc.length}/{DESC_MAX})</span>
            <textarea rows={3} className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink" value={seo.desc} onChange={(e) => setSeo({ ...seo, desc: e.target.value, saved: false })} /></label>
          {seo.queries.length > 0 && <p className="text-[11px] text-muted">Written from what people searched: {seo.queries.slice(0, 5).map((q) => `“${q}”`).join(", ")}</p>}
          {seo.err && <p className="text-xs text-red-700">{seo.err}</p>}
          <div className="flex items-center gap-2"><Button small onClick={save} disabled={seo.busy === "save" || !seo.title.trim() || seo.saved}>{seo.busy === "save" ? "Saving…" : seo.saved ? "Saved" : "Save to the product"}</Button>
            {seo.saved && <span className="text-xs text-emerald-700">Google will see it on its next visit.</span>}</div>
        </div>
      ))}
    </li>
  );
}

/** Runs the daily SEO agent now: up to 5 of these pages get a new Google title and description, with the same checks. */
function SeoAgent() {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  async function run() {
    setBusy(true); setOut(null);
    const { ok, j } = await call("/api/admin/seo/agent", "POST");
    setBusy(false);
    setOut({ ok, text: ok ? `${j.note}.${j.changed?.length ? ` Changed: ${j.changed.join(", ")}.` : ""}` : j.error || "The SEO agent didn't run. Try again." });
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-sm">
      <span className="text-ink/85">Every morning the AI rewrites up to 5 of these by itself. Each page rests 28 days between rewrites so Google can show the effect.</span>
      <Button small onClick={run} disabled={busy}><Sparkles className="mr-1 inline h-3.5 w-3.5" />{busy ? "Rewriting…" : "Fix 5 with AI now"}</Button>
      {out && <span className={out.ok ? "text-emerald-700" : "text-red-700"}>{out.text}</span>}
    </div>
  );
}


/* ------------------------------------------------------------ did the price changes work? */

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  more: { label: "More interest", cls: "bg-emerald-50 text-emerald-800" },
  fewer: { label: "Less interest", cls: "bg-red-50 text-red-800" },
  same: { label: "No change", cls: "bg-paper-2 text-ink/70" },
  quiet: { label: "Too few visits", cls: "bg-paper-2 text-muted" },
  too_soon: { label: "Too soon", cls: "bg-paper-2 text-muted" },
};
const KINDS = [{ id: "down", label: "Price cuts" }, { id: "up", label: "Price rises" }, { id: "first", label: "First prices on Call products" }] as const;
const perDay = (a: number, b: number) => `${a} → ${b}`;

function PriceEffects() {
  const [e, setE] = useState<Effects | null>(null);
  const [err, setErr] = useState("");
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { call("/api/admin/pricewire/insights?view=effects").then(({ ok, j }) => (ok ? setE(j) : setErr(j.error || "Could not load the price effects."))); }, []);
  async function writeNote() {
    setBusy(true); setMsg("");
    const { ok, j } = await call("/api/admin/pricewire/insights", "POST", { action: "effects-note" });
    setBusy(false);
    if (ok && j.ok) setE((x) => x && { ...x, note: { text: j.text, at: new Date().toISOString(), provider: j.provider } });
    else setMsg(j.note || j.error || "The AI didn't write a note. Try again.");
  }
  if (err) return <Notice tone="warning">{err}</Notice>;
  if (!e) return <Card className="p-5"><p className="text-sm text-muted">Comparing visits before and after each price change…</p></Card>;
  const judged = e.rows.filter((r) => r.verdict !== "too_soon");
  const rows = all ? e.rows : judged.slice(0, 12);
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-ink">Did the price changes work?</h2>
      <p className="text-xs text-muted">Product page views and call taps per day, in the {e.window} days before each price change and the days since (up to {e.window}). The newest change per product, last 30 days.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {KINDS.map((k) => { const s = e.summary[k.id]; return (
          <div key={k.id} className="rounded-lg border border-line bg-white p-3.5">
            <p className="text-xs text-muted">{k.label}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{s.n.toLocaleString("en-GB")}</p>
            <p className="mt-1 text-xs text-ink/80">{s.more} got more interest, {s.fewer} less</p>
            <p className="text-xs tabular-nums text-muted">Calls a day {perDay(s.callsBefore, s.callsAfter)} · views a day {perDay(s.viewsBefore, s.viewsAfter)}</p>
          </div>
        ); })}
      </div>
      <div className="mt-4 rounded-lg border border-line bg-paper-2/60 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-ink">The AI&apos;s read on it</p>
          <Button small onClick={writeNote} disabled={busy}><Sparkles className="mr-1 inline h-3.5 w-3.5" />{busy ? "Writing…" : e.note ? "Write a fresh note" : "Write this week's note"}</Button>
        </div>
        {e.note ? <><p className="mt-2 whitespace-pre-line text-ink/85">{e.note.text}</p><p className="mt-1 text-[11px] text-muted">Written {shortDay(e.note.at)}{e.note.provider ? ` by ${e.note.provider}` : ""}, from the numbers below only. A new note is written every Monday.</p></>
          : <p className="mt-1 text-muted">No note yet. One is written every Monday morning from the numbers below.</p>}
        {msg && <p className="mt-1 text-red-700">{msg}</p>}
      </div>
      {rows.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-[11px] text-muted"><th className="py-1.5 pr-3 font-medium">Product</th><th className="py-1.5 pr-3 font-medium">Price</th><th className="py-1.5 pr-3 font-medium">Changed</th><th className="py-1.5 pr-3 font-medium">Views a day</th><th className="py-1.5 pr-3 font-medium">Calls a day</th><th className="py-1.5 font-medium">Result</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1.5 pr-3"><a className="hover:text-blue-deep" href={`/products/${r.slug}`} target="_blank" rel="noreferrer"><span className="font-mono text-xs">{r.code}</span> <span className="text-muted">{r.brand}</span></a></td>
                <td className="py-1.5 pr-3 tabular-nums">{money(r.from)} → {money(r.to)}</td>
                <td className="py-1.5 pr-3 text-muted">{shortDay(r.at)}</td>
                <td className="py-1.5 pr-3 tabular-nums">{perDay(r.viewsBefore, r.viewsAfter)}</td>
                <td className="py-1.5 pr-3 tabular-nums">{perDay(r.callsBefore, r.callsAfter)}</td>
                <td className="py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${VERDICT[r.verdict].cls}`}>{VERDICT[r.verdict].label}</span></td>
              </tr>
            ))}</tbody>
          </table>
          {e.rows.length > 12 && <button type="button" className="mt-2 text-xs font-medium text-blue-deep hover:underline" onClick={() => setAll(!all)}>{all ? "Show the first 12" : `Show all ${e.rows.length.toLocaleString("en-GB")} changes`}</button>}
        </div>
      ) : <p className="mt-4 text-sm text-muted">No price changed in the last 30 days.</p>}
    </Card>
  );
}

/** GEO: buyer Q&A on the busiest product pages, for Google's AI answers, ChatGPT and Perplexity. */
function GeoAgent() {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  async function run() {
    setBusy(true); setOut(null);
    const { ok, j } = await call("/api/admin/pricewire/insights", "POST", { action: "geo" });
    setBusy(false);
    setOut({ ok, text: ok ? `${j.note}.${j.written?.length ? ` Written: ${j.written.join(", ")}.` : ""}` : j.error || "The AI didn't run. Try again." });
  }
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-ink">AI search answers</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink/85">Every morning the AI adds &quot;Questions buyers ask&quot; to 3 of the most-viewed product pages, written from the product&apos;s own specification. Google&apos;s AI answers, ChatGPT and Perplexity quote these and link the page. Answers never state a price or say &quot;free&quot;.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <Button small onClick={run} disabled={busy}><Sparkles className="mr-1 inline h-3.5 w-3.5" />{busy ? "Writing…" : "Write 3 now"}</Button>
        {out && <span className={out.ok ? "text-emerald-700" : "text-red-700"}>{out.text}</span>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ module */

export default function PricewireMarket() {
  const [m, setM] = useState<Market | null>(null);
  const [err, setErr] = useState("");
  const [job, setJob] = useState<Tag>("promote");
  useEffect(() => { call("/api/admin/pricewire/insights?view=market").then(({ ok, j }) => (ok ? setM(j) : setErr(j.error || "Could not load the market view. Try again."))); }, []);
  const lists = useMemo(() => Object.fromEntries(JOBS.map((j) => [j.id, (m?.cards || []).filter((c) => c.jobs[j.id]).sort((a, b) => a.jobs[j.id]!.rank - b.jobs[j.id]!.rank)])) as Record<Tag, MarketCard[]>, [m]);
  // Open on the first job that has something in it.
  useEffect(() => { if (m && !lists[job].length) { const first = JOBS.find((j) => lists[j.id].length); if (first) setJob(first.id); } }, [m]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <Notice tone="warning" className="mt-6">{err}</Notice>;
  if (!m) return <p className="mt-6 text-sm text-muted">Reading 30 days of prices, visitors and Google search…</p>;

  const listed = m.versus.reduce((a, v) => a + v.cheaper + v.same + v.dearer, 0), atOrUnder = m.versus.reduce((a, v) => a + v.cheaper + v.same, 0);
  const moved = m.trend.reduce((a, t) => a + t.up + t.down, 0);
  const brief: { text: string; job?: Tag }[] = [
    { text: m.pulse.changes7 || m.pulse.firstPrices7 ? `The price agent changed ${m.pulse.changes7} price${m.pulse.changes7 === 1 ? "" : "s"} by itself this week${m.pulse.firstPrices7 ? ` and put a first price on ${m.pulse.firstPrices7.toLocaleString("en-GB")} products that showed Call` : ""}.` : "No price needed changing this week: every site we follow held its prices." },
    ...(lists.dearer.length ? [{ text: `Ruislip Appliances is cheaper than us on ${m.versus.reduce((a, v) => a + v.dearer, 0)} Bosch, Neff and Siemens products.`, job: "dearer" as Tag }] : []),
    ...(lists.promote.length ? [{ text: `${lists.promote.length} products are priced right and already getting attention.`, job: "promote" as Tag }] : []),
    ...(lists.seo.length ? [{ text: `${lists.seo.length} product pages could rank higher on Google with a better search title.`, job: "seo" as Tag }] : []),
    ...(moved ? [{ text: `${moved} maker prices moved in the last ${m.days} days.`, job: "moved" as Tag }] : []),
  ];
  const active = JOBS.find((j) => j.id === job)!;

  return (
    <div className="mt-6 space-y-6">
      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink">This week</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-ink/85">
          {brief.map((b) => <li key={b.text} className="flex flex-wrap items-baseline gap-x-2">{b.text}{b.job && <button type="button" className="text-xs font-medium text-blue-deep hover:underline" onClick={() => { setJob(b.job!); document.getElementById("market-products")?.scrollIntoView({ behavior: "smooth" }); }}>Show them</button>}</li>)}
        </ul>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Pulse label="Prices changed by the price agent, 7 days" value={m.pulse.changes7} before={m.pulse.changesPrev7} />
          <Pulse label="Product page views, 7 days" value={m.pulse.views7} before={m.pulse.viewsPrev7} />
          <Pulse label="Call taps from product pages, 7 days" value={m.pulse.calls7} before={m.pulse.callsPrev7} />
          <Pulse label="At or under Ruislip Appliances' price" value={atOrUnder} note={listed ? `of the ${listed} products Ruislip also lists` : "Ruislip lists none of ours this week"} />
        </div>
      </Card>

      <PriceEffects />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-base font-semibold text-ink">Prices the price agent changed</h2>
          <p className="text-xs text-muted">Each day&apos;s automatic changes, last {m.days} days. First prices on Call products are not counted.</p>
          <div className="mt-3"><DayBars days={m.daily} up={(d) => d.up} down={(d) => d.down} upLabel="Went up" downLabel="Went down" /></div>
        </Card>
        <Card className="p-5">
          <h2 className="text-base font-semibold text-ink">Who&apos;s looking</h2>
          <p className="text-xs text-muted">Visits to product pages each day, and taps on the call button from them.</p>
          <div className="mt-3"><DayBars days={m.daily} up={(d) => d.views} upLabel="Product page views" height={104} /></div>
          <div className="mt-2"><DayBars days={m.daily} up={(d) => d.calls} upLabel="Call taps" height={64} /></div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink">Against Ruislip Appliances</h2>
        <p className="text-xs text-muted">Every priced Bosch, Neff and Siemens product, compared with Ruislip Appliances&apos; price this week.</p>
        <div className="mt-4 max-w-3xl"><Versus rows={m.versus} /></div>
      </Card>

      <section id="market-products" className="scroll-mt-20">
        <h2 className="text-base font-semibold text-ink">Products to act on</h2>
        <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="What the products need">
          {JOBS.map((j) => (
            <button key={j.id} type="button" role="tab" aria-selected={job === j.id} disabled={!lists[j.id].length} onClick={() => setJob(j.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium disabled:opacity-40 ${job === j.id ? "bg-navy text-paper" : "border border-line bg-white text-ink/80 hover:bg-paper-2"}`}>
              {j.label} <span className="tabular-nums opacity-70">{lists[j.id].length}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted">{active.lead}</p>
        {job === "seo" && lists.seo.length > 0 && <SeoAgent />}
        {job === "seo" && m.google !== "connected" && <Notice tone="info" className="mt-3">{m.google === "not_connected" ? "Google Search Console isn't connected, so this list uses visitor numbers only. Connect it under Admin → SEO to add Google's positions and clicks." : `Google Search Console didn't answer: ${m.google}`}</Notice>}
        {lists[job].length ? <ul className="mt-4 grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">{lists[job].map((c) => <ProductCard key={`${job}-${c.id}`} c={c} job={job} />)}</ul>
          : <p className="mt-4 text-sm text-muted">Nothing on this list right now.</p>}
      </section>

      <GeoAgent />

      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink">Profit</h2>
        {m.margin.withCost ? (
          <table className="mt-2 w-full max-w-xl text-sm"><thead><tr className="text-left text-[11px] text-muted"><th className="py-1.5 pr-3 font-medium">Model</th><th className="py-1.5 pr-3 font-medium">Price</th><th className="py-1.5 pr-3 font-medium">Cost, ex VAT</th><th className="py-1.5 font-medium">Margin</th></tr></thead>
            <tbody>{m.margin.rows.map((r) => <tr key={r.code} className="border-t border-line"><td className="py-1.5 pr-3"><a className="font-mono text-xs hover:text-blue-deep" href={`/products/${r.slug}`} target="_blank" rel="noreferrer">{r.code}</a></td><td className="py-1.5 pr-3 tabular-nums">{money(r.price)}</td><td className="py-1.5 pr-3 tabular-nums">{money(r.cost)}</td><td className="py-1.5 tabular-nums">{r.marginPct.toFixed(1)}%</td></tr>)}</tbody>
          </table>
        ) : <p className="mt-1 max-w-3xl text-sm text-muted">None of the {m.margin.priced.toLocaleString("en-GB")} priced Bosch, Neff and Siemens products has a cost price on file, so profit can&apos;t be worked out yet. Add costs on the product page, or upload a supplier price list in the AI desk, and the most profitable lines will be listed here.</p>}
      </Card>
    </div>
  );
}
