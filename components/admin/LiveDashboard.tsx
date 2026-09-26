"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Bot, Eye, MapPin, Phone, Search, ShieldCheck, ShoppingBag, Sparkles, Users } from "lucide-react";
import { Badge, Card } from "./ui";
import type { LiveSnapshot } from "@/lib/marketing/live";

/**
 * Admin → Live. Polls /api/admin/live every 15s. Everything here is real:
 * the site's own anonymous beacon, the enquiry pipeline, the crawl log, and
 * Search Console's freshest (hourly) figures. Nothing is estimated.
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
const BOT: Record<string, string> = {
  googlebot: "Googlebot", "googlebot-image": "Googlebot Images", "google-inspection": "Google URL Inspection",
  "google-storebot": "Google Shopping bot", "google-other": "Google (other)", bingbot: "Bingbot",
};

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

  if (!d) return <div className="p-10 text-sm text-muted">{err || "Connecting to the live site…"}</div>;

  const g = d.google;
  // Google keys its hours in its own time zone (ISO with offset); the shop thinks in UK days.
  const gToday = (g.hours || []).filter((h) => ukDay(h.key) === ukDay(new Date().toISOString()));
  const kpi = (label: string, icon: React.ReactNode, a: number, b: number) => ({ label, icon, a, b });
  const tiles = [
    kpi("Visits", <Users size={16} />, d.today.visits, d.yesterday.visits),
    kpi("Product views", <Eye size={16} />, d.today.productViews, d.yesterday.productViews),
    kpi("Call taps", <Phone size={16} />, d.today.calls, d.yesterday.calls),
    kpi("Postcode checks", <MapPin size={16} />, d.today.postcodes, d.yesterday.postcodes),
    kpi("Enquiries", <ShoppingBag size={16} />, d.today.enquiries, d.yesterday.enquiries),
  ];

  return (
    <div className="space-y-5">
      {/* ---------- Right now ---------- */}
      <section className="overflow-hidden rounded-xl bg-[var(--color-navy)] p-6 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4ade80] opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-[#22c55e]" />
            </span>
            <h1 className="font-display text-2xl">Live</h1>
            <span className="text-sm text-white/60">kitchen-appliances.co.uk, as it happens</span>
          </div>
          <span className="text-xs text-white/60">{err ? err : `updated ${ago(d.at, now)} · refreshes every 15s`}</span>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Big value={d.rightNow.views5} label="pages viewed in the last 5 minutes" />
          <Big value={d.rightNow.visits30} label={`visits in the last 30 minutes · ${n(d.rightNow.views30)} pages`} />
          <Big value={d.crawl.last24h} label={`pages Google & Bing crawled in 24h · ${n(d.crawl.pages)} different pages`} />
        </div>
      </section>

      {/* ---------- Today vs yesterday ---------- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map((k) => (
          <Card key={k.label} className="p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted">{k.icon}{k.label} today</div>
            <div className="mt-1 font-display text-3xl">{n(k.a)}</div>
            <Delta a={k.a} b={k.b} />
          </Card>
        ))}
      </div>

      {/* ---------- Charts ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <Head title="Last 24 hours on the site" note="page views per hour · Google's crawler in blue" />
          <Bars data={d.hours.map((h) => ({ label: h.label, a: h.views, b: h.crawls }))} aColor="var(--color-cta)" bColor="var(--color-sky)" />
        </Card>
        <Card className="p-5">
          <Head title="Seen on Google, hour by hour" note="Search Console · free results · last 3 days, today's hours included" />
          {!g.connected ? <p className="text-sm text-muted">Connect Google in Admin → Google Ads to see this.</p>
            : g.error ? <p className="text-sm text-danger">{g.error}</p>
            : (g.hours?.length ? <>
                <div className="mb-2 flex gap-5 text-sm">
                  <span><b className="font-display text-xl">{n(gToday.reduce((s, h) => s + h.impressions, 0))}</b> impressions today</span>
                  <span><b className="font-display text-xl">{n(gToday.reduce((s, h) => s + h.clicks, 0))}</b> clicks today</span>
                </div>
                <Bars data={(g.hours || []).slice(-48).map((h) => ({ label: ukHour(h.key), a: h.impressions, b: h.clicks }))} aColor="var(--color-blue)" bColor="var(--color-cta)" />
              </> : <p className="text-sm text-muted">Google hasn't reported any hours yet today.</p>)}
        </Card>
      </div>

      {/* ---------- What people want ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <Head title="What people are looking at today" note="product pages, most viewed first" />
          {d.topProducts.length ? (
            <ul className="divide-y divide-line">
              {d.topProducts.map((p) => (
                <li key={p.slug} className="flex items-center gap-3 py-2.5">
                  <div className="h-11 w-11 shrink-0 bg-white">{p.mainImage && <img src={p.mainImage} alt="" className="h-full w-full object-contain" />}</div>
                  <Link href={`/products/${p.slug}`} target="_blank" className="min-w-0 flex-1 truncate text-sm hover:text-blue">{p.title}</Link>
                  <span className="text-sm text-muted">{p.priceNow != null ? `£${p.priceNow}` : "call"}</span>
                  <Badge tone="info">{p.views} view{p.views === 1 ? "" : "s"}</Badge>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">No product pages viewed yet today.</p>}
        </Card>
        <Card className="p-5">
          <Head title="Where visits came from today" />
          {d.sources.length ? d.sources.map((s) => (
            <div key={s.name} className="mb-2.5">
              <div className="flex justify-between text-sm"><span>{s.name}</span><b>{s.visits}</b></div>
              <div className="mt-1 h-1.5 bg-paper-2"><div className="h-full bg-[var(--color-blue)]" style={{ width: `${(s.visits / d.sources[0].visits) * 100}%` }} /></div>
            </div>
          )) : <p className="text-sm text-muted">No visits yet today.</p>}
        </Card>
      </div>

      {/* ---------- Feeds ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <Head title="Live activity" note="anonymous — no names, no cookies" />
          <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {d.feed.map((e, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5 text-muted">{e.type === "call_click" ? <Phone size={14} /> : e.type === "postcode_check" ? <MapPin size={14} /> : <Eye size={14} />}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{e.type === "call_click" ? "Tapped Call" : e.type === "postcode_check" ? "Checked delivery postcode" : e.from ? "Arrived on" : "Viewed"}</span>{" "}
                  <span className="text-muted">{e.product || e.path || "/"}</span>
                  {e.from && <span className="ml-1 text-xs text-blue">from {e.from}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">{ago(e.at, now)}</span>
              </li>
            ))}
            {!d.feed.length && <li className="text-sm text-muted">Waiting for the first visitor…</li>}
          </ul>
        </Card>
        <Card className="p-5">
          <Head title="Google crawling the site" note={`${n(d.crawl.verified)} of ${n(d.crawl.last24h)} checked against Google's own address list`} />
          <div className="mb-3 flex flex-wrap gap-2">{d.crawl.byBot.map((b) => <Badge key={b.bot} tone="neutral">{BOT[b.bot] || b.bot} · {b.hits}</Badge>)}</div>
          <ul className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {d.crawl.recent.map((c, i) => (
              <li key={i} className="flex items-center gap-2.5 text-sm">
                {c.verified ? <ShieldCheck size={14} className="text-success" /> : <Bot size={14} className="text-muted" />}
                <span className="shrink-0 text-xs">{BOT[c.bot] || c.bot}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{c.path}</span>
                <span className="shrink-0 text-xs text-muted">{ago(c.at, now)}</span>
              </li>
            ))}
            {!d.crawl.recent.length && <li className="text-sm text-muted">No crawler visits recorded yet — they appear here as Google fetches pages.</li>}
          </ul>
        </Card>
      </div>

      {/* ---------- Money + Google searches ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <Head title="Sales" note="from Sales & Leads" />
          <div className="grid grid-cols-2 gap-3">
            <div><div className="font-display text-3xl text-success">{money(d.sales.wonValue)}</div><div className="text-xs text-muted">{d.sales.wonThisMonth} won this month</div></div>
            <div><div className="font-display text-3xl">{money(d.sales.openValue)}</div><div className="text-xs text-muted">{d.sales.open} open enquiries quoted</div></div>
          </div>
          <ul className="mt-4 space-y-1.5 text-sm">
            {d.sales.recent.map((e, i) => (
              <li key={i} className="flex justify-between gap-2"><span className="truncate">{e.product || "General enquiry"}</span><Badge tone={e.status === "won" || e.status === "closed" ? "success" : e.status === "lost" ? "danger" : "warning"}>{e.status}</Badge></li>
            ))}
          </ul>
          <Link href={salesHref} className="mt-3 inline-block text-sm text-blue">Open Sales & Leads →</Link>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <Head title="What people searched on Google" note="since yesterday, including today's fresh data" icon={<Search size={15} />} />
          {g.queries?.length ? (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="pb-1.5 font-normal">Search</th><th className="font-normal">Seen</th><th className="font-normal">Clicks</th><th className="font-normal">Position</th></tr></thead>
              <tbody>{g.queries.map((q) => (
                <tr key={q.key} className="border-t border-line"><td className="py-1.5 pr-2">{q.key}</td><td>{n(q.impressions)}</td><td>{n(q.clicks)}</td><td>{q.position.toFixed(1)}</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="text-sm text-muted">{g.connected ? "No searches reported for today yet." : "Connect Google in Admin → Google Ads to see this."}</p>}
        </Card>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted"><Sparkles size={12} /> Site figures are live. Google's figures arrive hourly and can lag a few hours. Visits count arrivals, not people; there is no online checkout, so sales are the enquiries marked won.</p>
    </div>
  );
}

function Big({ value, label }: { value: number; label: string }) {
  return <div><div className="font-display text-5xl tabular-nums">{n(value)}</div><div className="mt-1 text-sm text-white/65">{label}</div></div>;
}
function Head({ title, note, icon }: { title: string; note?: string; icon?: React.ReactNode }) {
  return <div className="mb-3"><h2 className="flex items-center gap-1.5 font-display text-lg">{icon}{title}</h2>{note && <p className="text-xs text-muted">{note}</p>}</div>;
}
function Delta({ a, b }: { a: number; b: number }) {
  if (!a && !b) return <div className="mt-1 text-xs text-muted">same as yesterday</div>;
  if (!b) return <div className="mt-1 text-xs text-success">none yesterday by now</div>;
  const up = a >= b, pct = b ? Math.round(((a - b) / b) * 100) : 100;
  return (
    <div className={`mt-1 flex items-center gap-0.5 text-xs ${up ? "text-success" : "text-danger"}`}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(pct)}% vs yesterday by now ({n(b)})
    </div>
  );
}
function Bars({ data, aColor, bColor }: { data: { label: string; a: number; b: number }[]; aColor: string; bColor: string }) {
  const w = 560, h = 170, pb = 18, max = Math.max(1, ...data.map((x) => Math.max(x.a, x.b)));
  const bw = w / Math.max(1, data.length), every = Math.ceil(data.length / 12);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="hourly chart">
      {data.map((x, i) => {
        const ha = (x.a / max) * (h - pb - 4), hb = (x.b / max) * (h - pb - 4);
        return (
          <g key={i}>
            <rect x={i * bw + 1} y={h - pb - ha} width={bw * 0.55} height={ha} fill={aColor}><title>{`${x.label}:00 · ${x.a} / ${x.b}`}</title></rect>
            <rect x={i * bw + 1 + bw * 0.55} y={h - pb - hb} width={bw * 0.35} height={hb} fill={bColor} />
            {i % every === 0 && <text x={i * bw + bw / 2} y={h - 4} fontSize="10" textAnchor="middle" fill="var(--color-muted)">{x.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}
