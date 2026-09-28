"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Bot, ChevronRight, Eye, MapPin, Phone, Search, ShieldCheck, ShoppingBag, Users } from "lucide-react";
import type { LiveSnapshot } from "@/lib/marketing/live";

/**
 * Admin → Live. Polls /api/admin/live every 15s. Everything here is real:
 * the site's own anonymous beacon, the enquiry pipeline, the crawl log, and
 * Search Console's freshest (hourly) figures. Nothing is estimated.
 *
 * Look: soft blue glass (the owner's reference, 27 Sept 2026) — rounded white
 * cards on a pale blue wash, small caps labels, trend lines, pill tags.
 */
type Row = { key: string; clicks: number; impressions: number; ctr: number; position: number };
type Data = LiveSnapshot & { google: { connected: boolean; error?: string; hours?: Row[]; queries?: Row[] } };

const n = (x: number) => Math.round(x).toLocaleString("en-GB");
const money = (x: number) => `£${Math.round(x).toLocaleString("en-GB")}`;
const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};
const ukDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London" });
const ukHour = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", timeZone: "Europe/London" });
const greeting = () => { const h = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/London" })); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const BOT: Record<string, string> = {
  googlebot: "Googlebot", "googlebot-image": "Googlebot Images", "google-inspection": "Google URL Inspection",
  "google-storebot": "Google Shopping bot", "google-other": "Google (other)", bingbot: "Bingbot",
};
const STATUS: Record<string, string> = { new: "bg-info-soft text-blue ring-sky", contacted: "bg-warning-soft text-warning ring-warning/30",
  quoted: "bg-info-soft text-blue ring-sky", won: "bg-success-soft text-success ring-success/30",
  closed: "bg-success-soft text-success ring-success/30", lost: "bg-danger-soft text-danger ring-danger/30" };

export default function LiveDashboard({ salesHref }: { salesHref: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/admin/live", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) setErr(j.error || "Live data unavailable"); else { setD(j); setErr(""); }
      } catch { if (alive) setErr("Can't reach the site right now — retrying"); }
    };
    load();
    const poll = setInterval(load, 15_000), tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(poll); clearInterval(tick); };
  }, []);

  if (!d) return <Wash><div className="p-10 text-sm text-muted">{err || "Connecting to the live site…"}</div></Wash>;

  const g = d.google;
  const gToday = (g.hours || []).filter((h) => ukDay(h.key) === ukDay(new Date().toISOString()));
  const series = (k: "visits" | "productViews" | "calls" | "views") => d.hours.map((h) => h[k]);
  const salesMix = [
    { label: "Won this month", value: d.sales.wonValue, color: "#37853c" },
    { label: "Open quotes", value: d.sales.openValue, color: "#0a2788" },
  ];

  return (
    <Wash>
      {/* ---------- Greeting + headline numbers ---------- */}
      <div className="grid gap-4 lg:grid-cols-4">
        <Glass className="flex flex-col justify-between p-5">
          <div className="flex items-center justify-between">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-blue text-sm font-semibold text-white">SK</span>
            <span className="flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-medium text-success">
              <span className="relative flex h-2 w-2"><span className="absolute h-full w-full animate-ping rounded-full bg-cta opacity-75" /><span className="relative h-2 w-2 rounded-full bg-cta" /></span>
              Live
            </span>
          </div>
          <div className="mt-6">
            <div className="text-lg font-semibold text-ink">{greeting()}, Sachin</div>
            <div className="mt-0.5 text-sm text-muted">
              {d.rightNow.views5 ? `${n(d.rightNow.views5)} page${d.rightNow.views5 === 1 ? "" : "s"} viewed in the last 5 minutes` : "The site is quiet this minute"}
            </div>
            <div className="mt-3 text-[11px] text-muted/80">{err || `Updated ${ago(d.at, now)} · refreshes every 15s`}</div>
          </div>
        </Glass>
        <Kpi label="Visits today" value={d.today.visits} before={d.yesterday.visits} points={series("visits")} icon={<Users size={14} />} />
        <Kpi label="Products viewed today" value={d.today.productViews} before={d.yesterday.productViews} points={series("productViews")} icon={<Eye size={14} />} />
        <Kpi label="Call taps today" value={d.today.calls} before={d.yesterday.calls} points={series("calls")} icon={<Phone size={14} />} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Mini label="Visits, last 30 minutes" value={n(d.rightNow.visits30)} sub={`${n(d.rightNow.views30)} pages`} />
        <Mini label="Delivery postcode checks today" value={n(d.today.postcodes)} sub={`${n(d.yesterday.postcodes)} yesterday by now`} icon={<MapPin size={14} />} />
        <Mini label="Enquiries today" value={n(d.today.enquiries)} sub={`${n(d.yesterday.enquiries)} yesterday by now`} icon={<ShoppingBag size={14} />} />
      </div>

      {/* ---------- Charts ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Glass className="p-5">
          <Head title="Last 24 hours on the site" right={<Legend items={[["People", "#37853c"], ["Google's crawler", "#93a8ef"]]} />} />
          <Area lines={[{ points: series("views"), color: "#37853c" }, { points: d.hours.map((h) => h.crawls), color: "#93a8ef" }]} labels={d.hours.map((h) => h.label)} />
        </Glass>
        <Glass className="p-5">
          <Head title="Seen on Google, hour by hour" right={<Legend items={[["Impressions", "#0a2788"], ["Clicks", "#37853c"]]} />} />
          {!g.connected ? <Empty>Connect Google in Admin → Google Ads to see this.</Empty>
            : g.error ? <p className="text-sm text-danger">{g.error}</p>
            : g.hours?.length ? <>
                <div className="mb-1 flex gap-6">
                  <Stat value={n(gToday.reduce((s, h) => s + h.impressions, 0))} label="impressions today" />
                  <Stat value={n(gToday.reduce((s, h) => s + h.clicks, 0))} label="clicks today" />
                </div>
                <Area lines={[{ points: g.hours.slice(-48).map((h) => h.impressions), color: "#0a2788" }, { points: g.hours.slice(-48).map((h) => h.clicks), color: "#37853c" }]}
                  labels={g.hours.slice(-48).map((h) => ukHour(h.key))} />
              </> : <Empty>Google hasn't reported any hours yet today.</Empty>}
        </Glass>
      </div>

      {/* ---------- Products (table) ---------- */}
      <Glass className="p-5">
        <Head title="What people are looking at today" right={<span className="text-xs text-muted/80">most viewed first</span>} />
        {d.topProducts.length ? (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted/80">
              <th className="pb-2 font-medium">Product</th><th className="pb-2 font-medium">Brand</th><th className="pb-2 font-medium">Price</th><th className="pb-2 text-right font-medium">Views</th>
            </tr></thead>
            <tbody>{d.topProducts.map((p, i) => (
              <tr key={p.slug} className="border-b border-line/70 last:border-0">
                <td className="py-2.5 pr-3">
                  <Link href={`/products/${p.slug}`} target="_blank" className="flex items-center gap-3 font-medium text-ink hover:text-blue">
                    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white ring-1 ring-line">{p.mainImage && <img src={p.mainImage} alt="" className="h-full w-full object-contain" />}</span>
                    <span className="line-clamp-1">{p.title}</span>
                  </Link>
                </td>
                <td className="text-muted">{p.brand}</td>
                <td className="text-muted">{p.priceNow != null ? `£${p.priceNow}` : <Pill className="bg-card text-muted ring-line">Call</Pill>}</td>
                <td className="text-right"><Pill className={i === 0 ? "bg-info-soft text-blue ring-sky" : "bg-card text-muted ring-line"}>{p.views}</Pill></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty>No product pages viewed yet today.</Empty>}
      </Glass>

      {/* ---------- Site search ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Glass className="p-5">
          <Head title="What people searched on this site" right={<span className="text-xs text-muted/80">{n(d.searches.today)} today · {n(d.searches.week)} in 7 days</span>} />
          {d.searches.top.length ? (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted/80"><th className="pb-2 font-medium">Search</th><th className="pb-2 text-right font-medium">Times</th><th className="pb-2 text-right font-medium">Opened a product</th></tr></thead>
              <tbody>{d.searches.top.map((q) => (
                <tr key={q.term} className="border-t border-line/70"><td className="py-2 pr-2 text-ink">{q.term}</td><td className="text-right text-muted">{n(q.times)}</td><td className="text-right text-muted">{n(q.picked)}</td></tr>
              ))}</tbody>
            </table>
          ) : <Empty>Searches appear here as people use the search box.</Empty>}
        </Glass>
        <Glass className="p-5">
          <Head title="Searched, found nothing" right={<span className="text-xs text-muted/80">7 days · products to add?</span>} />
          {d.searches.nothingFound.length ? (
            <ul className="space-y-2">
              {d.searches.nothingFound.map((q) => (
                <li key={q.term} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-ink"><Search size={13} className="shrink-0 text-warning" /><span className="truncate">{q.term}</span></span>
                  <span className="shrink-0 text-muted">{n(q.times)}×</span>
                </li>
              ))}
            </ul>
          ) : <Empty>No empty searches in the last 7 days.</Empty>}
        </Glass>
      </div>

      {/* ---------- Activity + sources ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Glass className="p-5 lg:col-span-2">
          <Head title="Live activity" right={<span className="text-xs text-muted/80">anonymous · no names, no cookies</span>} />
          <ul className="max-h-[380px] divide-y divide-line/70 overflow-y-auto pr-1">
            {d.feed.map((e, i) => (
              <li key={i} className="flex items-start gap-3 py-2.5">
                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${e.type === "call_click" ? "bg-success-soft text-success" : e.type === "postcode_check" || (e.type === "search" && e.found === false) ? "bg-warning-soft text-warning" : "bg-info-soft text-blue"}`}>
                  {e.type === "call_click" ? <Phone size={13} /> : e.type === "postcode_check" ? <MapPin size={13} /> : e.type === "search" ? <Search size={13} /> : <Eye size={13} />}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium text-ink">{e.type === "call_click" ? "Tapped Call" : e.type === "postcode_check" ? "Checked delivery postcode" : e.type === "search" ? "Searched" : e.from ? "Arrived on" : "Viewed"}</span>{" "}
                  {e.type === "search"
                    ? <span className="text-muted">“{e.path}”{e.found === false ? " · nothing found" : e.product ? ` → ${e.product}` : ""}</span>
                    : <span className="text-muted">{e.product || e.path || "/"}</span>}
                  {e.from && <div className="mt-0.5 text-xs text-blue">from {e.from}</div>}
                </span>
                <span className="shrink-0 text-xs text-muted/80">{ago(e.at, now)}</span>
              </li>
            ))}
            {!d.feed.length && <li className="py-3 text-sm text-muted">Waiting for the first visitor…</li>}
          </ul>
        </Glass>
        <Glass className="p-5">
          <Head title="Where visits came from" right={<span className="text-xs text-muted/80">today</span>} />
          {d.sources.length ? d.sources.map((s) => (
            <div key={s.name} className="mb-3">
              <div className="flex justify-between text-sm"><span className="text-ink">{s.name}</span><span className="font-semibold text-ink">{s.visits}</span></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper-2"><div className="h-full rounded-full bg-gradient-to-r from-blue to-sky" style={{ width: `${(s.visits / d.sources[0].visits) * 100}%` }} /></div>
            </div>
          )) : <Empty>No visits yet today.</Empty>}
        </Glass>
      </div>

      {/* ---------- Sales + searches + crawl ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Glass className="p-5">
          <Head title="Sales" right={<Link href={salesHref} className="flex items-center text-xs text-muted hover:text-blue">Sales & Leads <ChevronRight size={14} /></Link>} />
          <div className="flex items-end gap-5">
            <div className="flex h-24 items-end gap-2">
              {salesMix.map((m) => (
                <div key={m.label} className="w-3 rounded-full" style={{ background: m.color, height: `${Math.max(8, (m.value / Math.max(1, ...salesMix.map((x) => x.value))) * 96)}px` }} />
              ))}
            </div>
            <div className="flex-1 space-y-2 text-sm">
              {salesMix.map((m) => (
                <div key={m.label} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-muted"><span className="h-2 w-2 rounded-full" style={{ background: m.color }} />{m.label}</span>
                  <span className="font-semibold text-ink">{money(m.value)}</span>
                </div>
              ))}
              <div className="text-xs text-muted/80">{d.sales.wonThisMonth} won · {d.sales.open} open</div>
            </div>
          </div>
          <ul className="mt-4 space-y-2 border-t border-line/70 pt-3 text-sm">
            {d.sales.recent.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="truncate text-ink">{e.product || "General enquiry"}</span>
                <Pill className={STATUS[e.status] || STATUS.new}>{e.status}</Pill>
              </li>
            ))}
            {!d.sales.recent.length && <li className="text-muted">No enquiries this month yet.</li>}
          </ul>
        </Glass>
        <Glass className="p-5">
          <Head title="What people searched on Google" right={<span className="text-xs text-muted/80">since yesterday</span>} />
          {g.queries?.length ? (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted/80"><th className="pb-2 font-medium">Search</th><th className="pb-2 text-right font-medium">Seen</th><th className="pb-2 text-right font-medium">Clicks</th></tr></thead>
              <tbody>{g.queries.slice(0, 10).map((q) => (
                <tr key={q.key} className="border-t border-line/70"><td className="py-2 pr-2 text-ink">{q.key}</td><td className="text-right text-muted">{n(q.impressions)}</td>
                  <td className="text-right">{q.clicks ? <Pill className="bg-success-soft text-success ring-success/30">{n(q.clicks)}</Pill> : <span className="text-muted/80">0</span>}</td></tr>
              ))}</tbody>
            </table>
          ) : <Empty>{g.connected ? "No searches reported for today yet." : "Connect Google in Admin → Google Ads to see this."}</Empty>}
        </Glass>
        <Glass className="p-5">
          <Head title="Google crawling the site" right={<span className="text-xs text-muted/80">{n(d.crawl.last24h)} in 24h</span>} />
          <div className="mb-3 flex flex-wrap gap-1.5">{d.crawl.byBot.map((b) => <Pill key={b.bot} className="bg-info-soft text-blue ring-sky">{BOT[b.bot] || b.bot} · {b.hits}</Pill>)}</div>
          <ul className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {d.crawl.recent.map((c, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                {c.verified ? <ShieldCheck size={14} className="shrink-0 text-success" /> : <Bot size={14} className="shrink-0 text-muted/80" />}
                <span className="min-w-0 flex-1 truncate text-muted">{c.path}</span>
                <span className="shrink-0 text-xs text-muted/80">{ago(c.at, now)}</span>
              </li>
            ))}
            {!d.crawl.recent.length && <li className="text-sm text-muted">Pages appear here as Google fetches them.</li>}
          </ul>
          <p className="mt-3 text-[11px] text-muted/80">{n(d.crawl.verified)} of {n(d.crawl.last24h)} confirmed as the real Google</p>
        </Glass>
      </div>

      <p className="px-1 text-xs text-muted">Site figures are live. Google&apos;s figures arrive hourly and can lag a few hours. Visits count arrivals, not people; there is no online checkout, so sales are the enquiries marked won.</p>
    </Wash>
  );
}

/* ------------------------------------------------------------ pieces */

function Wash({ children }: { children: ReactNode }) {
  return <div className="-m-4 space-y-4 rounded-[28px] bg-gradient-to-br from-card via-paper-2 to-[#dde3f1] p-4 sm:-m-6 sm:p-6">{children}</div>;
}
function Glass({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-[20px] border border-white/80 bg-white/70 shadow-[0_10px_30px_-12px_rgba(8,21,56,0.18)] backdrop-blur-md ${className}`}>{children}</div>;
}
function Head({ title, right }: { title: string; right?: ReactNode }) {
  return <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h2>{right}</div>;
}
function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-[10px] px-2 py-0.5 text-xs font-medium capitalize ring-1 ${className}`}>{children}</span>;
}
function Empty({ children }: { children: ReactNode }) { return <p className="py-6 text-center text-sm text-muted">{children}</p>; }
function Stat({ value, label }: { value: string; label: string }) {
  return <div><div className="text-2xl font-semibold text-ink">{value}</div><div className="text-xs text-muted">{label}</div></div>;
}
function Legend({ items }: { items: [string, string][] }) {
  return <div className="flex gap-3">{items.map(([l, c]) => <span key={l} className="flex items-center gap-1.5 text-xs text-muted"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>)}</div>;
}
function Mini({ label, value, sub, icon }: { label: string; value: string; sub: string; icon?: ReactNode }) {
  return (
    <Glass className="flex items-center justify-between p-4">
      <div><div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</div><div className="mt-1 text-xs text-muted/80">{sub}</div></div>
      <div className="flex items-center gap-1.5 text-2xl font-semibold text-ink">{icon && <span className="text-muted/80">{icon}</span>}{value}</div>
    </Glass>
  );
}
function Kpi({ label, value, before, points, icon }: { label: string; value: number; before: number; points: number[]; icon: ReactNode }) {
  const up = value >= before, pct = before ? Math.round(((value - before) / before) * 100) : null;
  const color = !before && !value ? "#5b6577" : up ? "#37853c" : "#b3261e";
  return (
    <Glass className="p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{icon}{label}</div>
        <Spark points={points} color={color} />
      </div>
      <div className="mt-3 text-3xl font-semibold text-ink">{n(value)}</div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-muted/80">vs {n(before)} yesterday by now</span>
        <span className="flex items-center font-semibold" style={{ color }}>
          {pct === null ? (value ? "new" : "—") : <>{up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(pct)}%</>}
        </span>
      </div>
    </Glass>
  );
}

/** Smooth path through points (Catmull-Rom → cubic Bézier); control points never dip below `floor`, so a sudden jump can't draw a negative count. */
function smooth(xy: [number, number][], floor = Infinity) {
  const c = (y: number) => Math.min(y, floor).toFixed(1);
  if (!xy.length) return "";
  let p = `M${xy[0][0]},${xy[0][1]}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const [x0, y0] = xy[i - 1] || xy[i], [x1, y1] = xy[i], [x2, y2] = xy[i + 1], [x3, y3] = xy[i + 2] || xy[i + 1];
    p += ` C${(x1 + (x2 - x0) / 6).toFixed(1)},${c(y1 + (y2 - y0) / 6)} ${(x2 - (x3 - x1) / 6).toFixed(1)},${c(y2 - (y3 - y1) / 6)} ${x2},${y2}`;
  }
  return p;
}
function Spark({ points, color }: { points: number[]; color: string }) {
  const w = 96, h = 34, max = Math.max(1, ...points);
  const xy = points.map((v, i) => [i * (w / Math.max(1, points.length - 1)), h - 3 - (v / max) * (h - 6)] as [number, number]);
  return <svg width={w} height={h} aria-hidden><path d={smooth(xy, h - 3)} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" /></svg>;
}
function Area({ lines, labels }: { lines: { points: number[]; color: string }[]; labels: string[] }) {
  const w = 560, h = 180, pb = 20, max = Math.max(1, ...lines.flatMap((l) => l.points));
  const every = Math.ceil(labels.length / 8);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="hourly chart">
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={w} y1={(h - pb) * f} y2={(h - pb) * f} stroke="#d9dfee" strokeDasharray="3 4" />)}
      {lines.map((l, k) => {
        const xy = l.points.map((v, i) => [i * (w / Math.max(1, l.points.length - 1)), h - pb - (v / max) * (h - pb - 8)] as [number, number]);
        const line = smooth(xy, h - pb);
        return (
          <g key={k}>
            <defs><linearGradient id={`fill${k}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={l.color} stopOpacity="0.22" /><stop offset="100%" stopColor={l.color} stopOpacity="0" /></linearGradient></defs>
            {xy.length > 1 && <path d={`${line} L${w},${h - pb} L0,${h - pb} Z`} fill={`url(#fill${k})`} />}
            <path d={line} fill="none" stroke={l.color} strokeWidth="2.4" strokeLinecap="round" />
            {xy.length > 0 && <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="3.5" fill="white" stroke={l.color} strokeWidth="2" />}
          </g>
        );
      })}
      {labels.map((lb, i) => i % every === 0 && <text key={i} x={i * (w / Math.max(1, labels.length - 1))} y={h - 4} fontSize="10" textAnchor="middle" fill="#5b6577">{lb}</text>)}
    </svg>
  );
}
