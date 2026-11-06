"use client";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Notice } from "@/components/admin/ui";
import type { Alert, HistorySeries, Rule } from "@/lib/price-watch/pricing-rules";
import type { PriceCandidate } from "@/lib/price-watch/pricewire-map";
import { queueChanged } from "@/components/admin/PricewireAI";

/**
 * Admin → Pricewire → Engine: alerts, pricing rules, mapping (finding products
 * on a site, confirming matches, teaching a site where its price is) and price
 * history. Rules only fill the review queue in the AI desk below.
 */
type Site = { id: string; name: string; kind: string; url: string };
type Props = { sites: Site[]; sources: { id: string; label: string }[]; brands: string[]; categories: string[] };
type Msg = { tone: "success" | "warning" | "danger" | "info"; text: string } | null;

const input = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm";
const money = (n: number | null | undefined) => (typeof n !== "number" ? "—" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const when = (iso: string | Date | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
async function call(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: r.ok, j: await r.json().catch(() => ({})) };
}


/* ------------------------------------------------------------ alerts */

function Alerts() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const load = useCallback(async () => { const { ok, j } = await call("/api/admin/pricewire/insights?view=alerts"); setAlerts(ok ? j.alerts : []); }, []);
  useEffect(() => { load(); }, [load]);
  if (!alerts) return <p className="text-xs text-muted">Checking…</p>;
  if (!alerts.length) return <Notice tone="success">Nothing needs a look: no one undercuts us by 5% or more, and every site is reading normally.</Notice>;
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => (
        <div key={i} className="flex items-start gap-2 text-sm">
          <Badge tone={a.level === "danger" ? "danger" : a.level === "warning" ? "warning" : "info"}>{a.kind.replace(/_/g, " ")}</Badge>
          <span className="text-ink/85">{a.slug ? <a className="hover:text-blue-deep" href={`/products/${a.slug}`} target="_blank" rel="noreferrer">{a.text}</a> : a.text}</span>
        </div>
      ))}
      <button type="button" onClick={load} className="text-xs text-muted hover:text-blue-deep">Check again</button>
    </div>
  );
}

/* ------------------------------------------------------------ rules */

const STRATEGY: Record<string, string> = { beat_lowest: "Go under the lowest source", match_lowest: "Match the lowest source", match_source: "Follow one source" };
const blank = { name: "", enabled: true, priority: 100, brand: "", category: "", strategy: "beat_lowest", sourceIds: "", amount: 5, amountUnit: "gbp", rounding: "99", minMarginPct: 0.1, capAtMaker: true, maxChangePct: 25 };

function RuleForm({ initial, sources, brands, categories, onDone }: { initial?: Rule; onDone: () => void } & Omit<Props, "sites">) {
  const [f, setF] = useState<any>(initial ? { ...initial } : { ...blank });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const picked = new Set(String(f.sourceIds || "").split(",").filter(Boolean));
  const toggleSource = (id: string) => { const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); setF({ ...f, sourceIds: [...n].join(",") }); };
  async function save() {
    setBusy(true); setMsg(null);
    const { ok, j } = await call("/api/admin/pricewire/rules", initial ? "PATCH" : "POST", { ...f, id: initial?.id, amount: Number(f.amount), priority: Number(f.priority), minMarginPct: Number(f.minMarginPct), maxChangePct: Number(f.maxChangePct) });
    setBusy(false);
    if (ok) onDone(); else setMsg({ tone: "danger", text: j.error || "Could not save." });
  }
  return (
    <div className="rounded-xl border border-blue/30 bg-paper-2/40 p-4 text-sm">
      <div className="grid gap-3 md:grid-cols-3">
        <label><span className="font-medium text-ink">Name</span><input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Bosch dishwashers: beat by £5" /></label>
        <label><span className="font-medium text-ink">Brand</span><select className={input} value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })}><option value="">Every brand</option>{brands.map((b) => <option key={b}>{b}</option>)}</select></label>
        <label><span className="font-medium text-ink">Category</span><select className={input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Every category</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label><span className="font-medium text-ink">What it does</span><select className={input} value={f.strategy} onChange={(e) => setF({ ...f, strategy: e.target.value })}>{Object.entries(STRATEGY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {f.strategy === "beat_lowest" && <label><span className="font-medium text-ink">By how much</span><div className="flex gap-2"><input type="number" min={0} step="0.5" className={input} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><select className={input} value={f.amountUnit} onChange={(e) => setF({ ...f, amountUnit: e.target.value })}><option value="gbp">£</option><option value="pct">%</option></select></div></label>}
        <label><span className="font-medium text-ink">Price ending <span className="font-normal text-muted">(from £50)</span></span><select className={input} value={f.rounding} onChange={(e) => setF({ ...f, rounding: e.target.value })}><option value="99">.99</option><option value="00">whole pounds</option><option value="none">exact</option></select></label>
        <label><span className="font-medium text-ink">Margin over cost (when known)</span><select className={input} value={f.minMarginPct} onChange={(e) => setF({ ...f, minMarginPct: e.target.value })}>{[0, 0.05, 0.1, 0.15, 0.2, 0.25].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}</select></label>
        <label><span className="font-medium text-ink">Hold moves bigger than</span><select className={input} value={f.maxChangePct} onChange={(e) => setF({ ...f, maxChangePct: e.target.value })}>{[10, 15, 25, 40, 60].map((v) => <option key={v} value={v}>{v}%</option>)}</select></label>
        <label><span className="font-medium text-ink">Order (lower first)</span><input type="number" className={input} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} /></label>
      </div>
      <fieldset className="mt-3"><legend className="font-medium text-ink">{f.strategy === "match_source" ? "The source to follow (first ticked that has a price)" : "Sources to compare (none ticked = all)"}</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{sources.map((s) => <label key={s.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={picked.has(s.id)} onChange={() => toggleSource(s.id)} />{s.label}</label>)}</div></fieldset>
      <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={f.capAtMaker} onChange={(e) => setF({ ...f, capAtMaker: e.target.checked })} />Never above the maker's own price</label>
      <div className="mt-3 flex gap-2"><Button small onClick={save} disabled={busy || !f.name}>{busy ? "Saving…" : initial ? "Save rule" : "Add rule"}</Button><Button small variant="ghost" onClick={onDone}>Cancel</Button></div>
      {msg && <Notice tone={msg.tone} className="mt-2">{msg.text}</Notice>}
    </div>
  );
}

function Rules(props: Omit<Props, "sites">) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [edit, setEdit] = useState<Rule | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const load = useCallback(async () => { const { ok, j } = await call("/api/admin/pricewire/rules"); if (ok) setRules(j.rules); }, []);
  useEffect(() => { load(); }, [load]);
  const label = (id: string) => props.sources.find((s) => s.id === id)?.label || id;
  async function run() {
    setBusy(true); setMsg(null);
    const { ok, j } = await call("/api/admin/pricewire/rules", "POST", { action: "run" });
    setBusy(false);
    if (!ok) { setMsg({ tone: "danger", text: j.error || "The rules didn't run." }); return; }
    setMsg({ tone: j.suggested ? "success" : "info", text: j.suggested ? `${j.suggested} new suggestions are waiting in the review queue below.` : "No new suggestions: every product is already where its rule puts it, or has no source price." });
    load(); queueChanged();
  }
  async function toggle(r: Rule) { await call("/api/admin/pricewire/rules", "PATCH", { id: r.id, enabled: !r.enabled }); load(); }
  async function remove(r: Rule) { if (!confirm(`Delete the rule “${r.name}”?`)) return; await call("/api/admin/pricewire/rules", "DELETE", { id: r.id }); load(); }
  return (
    <div>
      <p className="text-xs text-muted">A rule turns the other sources' prices into ours — e.g. £5 under the lowest dealer, ending .99, never below cost, never above the maker. Rules run after the morning read; their prices wait in the review queue until you apply them.</p>
      <div className="mt-3 space-y-2">
        {rules.map((r) => (
          <div key={r.id} className="rounded-xl border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">{r.name}</span>
              <Badge tone={r.enabled ? "success" : "neutral"}>{r.enabled ? "on" : "off"}</Badge>
              <span className="text-xs text-muted">{r.brand || "every brand"} · {r.category || "every category"}</span>
              <span className="ml-auto flex gap-2 text-xs">
                <button type="button" className="text-blue-deep hover:underline" onClick={() => toggle(r)}>{r.enabled ? "Turn off" : "Turn on"}</button>
                <button type="button" className="text-blue-deep hover:underline" onClick={() => setEdit(r)}>Edit</button>
                <button type="button" className="text-danger hover:underline" onClick={() => remove(r)}>Delete</button>
              </span>
            </div>
            <p className="mt-1 text-xs text-ink/75">
              {STRATEGY[r.strategy]}{r.strategy === "beat_lowest" ? ` by ${r.amountUnit === "pct" ? `${r.amount}%` : `£${r.amount}`}` : ""}
              {r.sourceIds ? ` — ${r.sourceIds.split(",").map(label).join(", ")}` : " — all sources"}; ending {r.rounding === "99" ? ".99" : r.rounding === "00" ? "whole pounds" : "exact"};
              {" "}never below cost + {Math.round(r.minMarginPct * 100)}%{r.capAtMaker ? "; never above the maker" : ""}; moves over {r.maxChangePct}% held.
            </p>
            <p className="mt-0.5 text-[11px] text-muted">Last run {when(r.lastRunAt)}{r.lastRunSummary ? ` — ${r.lastRunSummary}` : ""}</p>
          </div>
        ))}
        {!rules.length && !edit && <p className="text-xs text-muted">No rules yet.</p>}
      </div>
      {edit ? <div className="mt-3"><RuleForm {...props} initial={edit === "new" ? undefined : edit} onDone={() => { setEdit(null); load(); }} /></div> : (
        <div className="mt-3 flex gap-2"><Button small variant="secondary" onClick={() => setEdit("new")}>New rule</Button><Button small onClick={run} disabled={busy || !rules.some((r) => r.enabled)}>{busy ? "Running…" : "Run rules now"}</Button></div>
      )}
      {msg && <Notice tone={msg.tone} className="mt-2">{msg.text}</Notice>}
    </div>
  );
}

/* ------------------------------------------------------------ mapping */

function Mapping({ sites, brands }: { sites: Site[]; brands: string[] }) {
  const pageSites = sites.filter((s) => s.kind !== "list");
  const [siteId, setSiteId] = useState(pageSites.find((s) => s.kind === "search")?.id || pageSites[0]?.id || "");
  const [info, setInfo] = useState<any>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState("");
  const [brand, setBrand] = useState("");
  const [found, setFound] = useState<any[] | null>(null);
  const [teachUrl, setTeachUrl] = useState("");
  const [teachCode, setTeachCode] = useState("");
  const [cands, setCands] = useState<PriceCandidate[] | null>(null);
  const load = useCallback(async () => { if (!siteId) return; const { ok, j } = await call(`/api/admin/pricewire/mapping?siteId=${encodeURIComponent(siteId)}`); setInfo(ok ? j : null); }, [siteId]);
  useEffect(() => { setFound(null); setCands(null); setMsg(null); load(); }, [load]);
  const site = info?.site;

  async function findProducts() {
    setBusy("find"); setMsg(null); setFound(null);
    const { ok, j } = await call("/api/admin/pricewire/mapping", "POST", { action: "discover", siteId, brand: brand || undefined, limit: 10 });
    setBusy("");
    if (!ok) { setMsg({ tone: "danger", text: j.error || "The search failed." }); return; }
    setFound(j.results); load();
  }
  async function decide(productId: string, status: "confirmed" | "rejected") { await call("/api/admin/pricewire/mapping", "PATCH", { siteId, productId, status }); load(); }
  async function teach() {
    setBusy("teach"); setMsg(null); setCands(null);
    const { ok, j } = await call("/api/admin/pricewire/mapping", "POST", { action: "teach", siteId, url: teachUrl, code: teachCode });
    setBusy("");
    if (!ok) { setMsg({ tone: "danger", text: j.error || "That page didn't load." }); return; }
    setCands(j.candidates);
    if (!j.candidates.length) setMsg({ tone: "warning", text: "No £ prices were found on that page as text — it may load its prices with scripts, which can't be read this way." });
    else if (j.namesModel === false) setMsg({ tone: "warning", text: `That page doesn't mention ${teachCode} — make sure it's the right product.` });
  }
  async function pick(c: PriceCandidate) {
    setBusy("save");
    const { ok, j } = await call("/api/admin/pricewire/mapping", "POST", { action: "save-selector", siteId, url: teachUrl, selector: c.selector });
    setBusy("");
    setMsg(ok ? { tone: "success", text: `Learned: ${site?.name} shows its price in “${j.selector}” (${money(j.price)} on this page). Pages without structured data will be read there.` } : { tone: "danger", text: j.error || "Could not save." });
    if (ok) { setCands(null); load(); }
  }
  async function forget() { await call("/api/admin/pricewire/mapping", "POST", { action: "clear-selector", siteId }); load(); }

  if (!pageSites.length) return <p className="text-xs text-muted">Add a product-page or search site first.</p>;
  const c = info?.counts || {};
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label><span className="font-medium text-ink">Site</span><select className={input} value={siteId} onChange={(e) => setSiteId(e.target.value)}>{pageSites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.kind === "search" ? " (search)" : ""}</option>)}</select></label>
        {site && <p className="pb-2 text-xs text-muted">{c.auto || 0} found automatically · {c.confirmed || 0} confirmed · {c.review || 0} to confirm · {c.rejected || 0} rejected{site.priceSelector ? <> · price location <code>{site.priceSelector}</code>{site.selectorMisses >= 5 ? <Badge tone="danger">layout changed?</Badge> : null}</> : ""}</p>}
      </div>

      {site?.kind === "search" && (
        <div className="mt-4 rounded-xl border border-line p-3">
          <h4 className="font-medium text-ink">Find our products on {site.name}</h4>
          <p className="text-xs text-muted">Searches the site for each model we sell that it hasn't been matched to yet (10 at a time; the morning run also does 40 a day). A page whose data names the model or EAN is used automatically; a page matched only by its title waits for you below.</p>
          <div className="mt-2 flex gap-2"><select className={`${input} mt-0 w-40`} value={brand} onChange={(e) => setBrand(e.target.value)}><option value="">Every brand</option>{brands.map((b) => <option key={b}>{b}</option>)}</select>
            <Button small onClick={findProducts} disabled={!!busy}>{busy === "find" ? "Searching…" : "Find 10 products"}</Button></div>
          {found && <ul className="mt-2 space-y-0.5 text-xs">{found.map((r, i) => <li key={i}><b>{r.code}</b> — {r.status === "auto" ? <span className="text-success">found ({r.matchedBy.replace(/_/g, " ")})</span> : r.status === "review" ? <span className="text-warning">possible match, confirm below</span> : <span className="text-muted">{r.matchedBy}</span>}{r.url && <> · <a className="text-blue-deep hover:underline" href={r.url} target="_blank" rel="noreferrer">page</a></>}</li>)}{!found.length && <li className="text-muted">Every product is matched already.</li>}</ul>}
        </div>
      )}

      {info?.review?.length > 0 && (
        <div className="mt-4">
          <h4 className="font-medium text-ink">Matches to confirm</h4>
          <table className="mt-1 w-full text-left text-xs"><tbody>
            {info.review.map((r: any) => (
              <tr key={r.productId} className="border-b border-line/70">
                <td className="py-1.5 pr-2"><b>{r.productCode}</b> <span className="text-muted">{r.title}</span></td>
                <td className="py-1.5 pr-2"><a className="text-blue-deep hover:underline" href={r.url} target="_blank" rel="noreferrer">their page</a> <span className="text-muted">({r.matchedBy})</span></td>
                <td className="py-1.5 text-right"><button type="button" className="mr-3 font-medium text-success hover:underline" onClick={() => decide(r.productId, "confirmed")}>Same product</button><button type="button" className="text-danger hover:underline" onClick={() => decide(r.productId, "rejected")}>Not it</button></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-line p-3">
        <h4 className="font-medium text-ink">Teach Pricewire where {site?.name || "this site"} shows its price</h4>
        <p className="text-xs text-muted">For sites without structured product data. Paste one of their product pages, then click the price customers pay.</p>
        <div className="mt-2 grid gap-2 md:grid-cols-[3fr_1fr_auto]">
          <input className={`${input} mt-0 font-mono text-xs`} value={teachUrl} onChange={(e) => setTeachUrl(e.target.value)} placeholder="https://… one product page on this site" />
          <input className={`${input} mt-0 font-mono text-xs`} value={teachCode} onChange={(e) => setTeachCode(e.target.value)} placeholder="its model code" />
          <Button small variant="secondary" onClick={teach} disabled={!!busy || !teachUrl}>{busy === "teach" ? "Reading…" : "Show its prices"}</Button>
        </div>
        {cands && cands.length > 0 && (
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {cands.map((c, i) => (
              <button key={i} type="button" onClick={() => pick(c)} disabled={!!busy} className="rounded-lg border border-line bg-white p-2 text-left hover:border-blue">
                <span className="font-semibold text-ink">{money(c.price)}</span> <span className="text-xs text-muted">“{c.text}”</span>
                <span className="block truncate text-[11px] text-muted">…{c.context}</span>
                <code className="text-[10.5px] text-blue-deep">{c.selector}</code>
              </button>
            ))}
          </div>
        )}
        {site?.priceSelector && <button type="button" className="mt-2 text-xs text-muted hover:text-danger" onClick={forget}>Forget the learned location ({site.priceSelector})</button>}
      </div>
      {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
    </div>
  );
}

/* ------------------------------------------------------------ history */

const COLOURS = ["#0b2545", "#3b82c4", "#d97706", "#16a34a", "#9333ea", "#dc2626", "#0891b2"];
function Chart({ series }: { series: HistorySeries[] }) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return null;
  const t = pts.map((p) => new Date(p.at).getTime()), v = pts.map((p) => p.price);
  const [t0, t1] = [Math.min(...t), Math.max(...t, Math.min(...t) + 86_400_000)];
  const [v0, v1] = [Math.min(...v) * 0.97, Math.max(...v) * 1.03];
  const W = 640, H = 220, L = 52, B = 22;
  const x = (at: string) => L + ((new Date(at).getTime() - t0) / (t1 - t0)) * (W - L - 8);
  const y = (p: number) => 8 + (1 - (p - v0) / (v1 - v0 || 1)) * (H - B - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Price history chart">
      {[0, 0.5, 1].map((f) => { const p = v0 + (v1 - v0) * f; return <g key={f}><line x1={L} x2={W - 8} y1={y(p)} y2={y(p)} stroke="#e5e7eb" /><text x={L - 6} y={y(p) + 4} fontSize="10" textAnchor="end" fill="#6b7280">£{Math.round(p)}</text></g>; })}
      <text x={L} y={H - 6} fontSize="10" fill="#6b7280">{new Date(t0).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</text>
      <text x={W - 8} y={H - 6} fontSize="10" textAnchor="end" fill="#6b7280">{new Date(t1).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</text>
      {series.map((s, i) => (
        <g key={s.label}>
          <polyline fill="none" stroke={COLOURS[i % COLOURS.length]} strokeWidth={i === 0 ? 2.5 : 1.5} strokeLinejoin="round"
            points={s.points.map((p, k) => `${x(p.at)},${y(k > 0 && i === 0 ? s.points[k - 1].price : p.price)} ${x(p.at)},${y(p.price)}`).join(" ")} />
          {s.points.map((p, k) => <circle key={k} cx={x(p.at)} cy={y(p.price)} r={2} fill={COLOURS[i % COLOURS.length]}><title>{`${s.label}: ${money(p.price)} · ${when(p.at)}`}</title></circle>)}
        </g>
      ))}
    </svg>
  );
}

function History() {
  const [code, setCode] = useState("");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  async function look() {
    setErr(""); setData(null);
    const { ok, j } = await call(`/api/admin/pricewire/insights?code=${encodeURIComponent(code.trim())}`);
    if (ok) setData(j); else setErr(j.error || "Not found.");
  }
  return (
    <div className="text-sm">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) look(); }}>
        <input className={`${input} mt-0 max-w-xs font-mono text-xs`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Model code, e.g. WGG24409GB" />
        <Button small variant="secondary" disabled={!code.trim()}>Show history</Button>
      </form>
      {err && <Notice tone="warning" className="mt-2">{err}</Notice>}
      {data && (
        <div className="mt-3">
          <p className="font-medium text-ink">{data.product.productCode} <span className="font-normal text-muted">{data.product.title} · now {money(data.product.priceNow)}</span></p>
          {data.series.length ? <>
            <Chart series={data.series} />
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">{data.series.map((s: HistorySeries, i: number) => <span key={s.label} className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded" style={{ background: COLOURS[i % COLOURS.length] }} />{s.label}: {money(s.points[s.points.length - 1].price)}</span>)}</div>
          </> : <p className="mt-2 text-xs text-muted">No price changes or source reads in the last 90 days.</p>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ shell */

const TABS = ["Alerts", "Pricing rules", "Mapping", "Price history"] as const;
export default function PricewireEngine(props: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Alerts");
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-3">
        <nav className="flex flex-wrap gap-1" role="tablist" aria-label="Pricing engine">
          {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${tab === t ? "bg-navy text-paper" : "text-ink/70 hover:bg-paper-2"}`}>{t}</button>)}
        </nav>
      </div>
      <div className="mt-4">
        {tab === "Alerts" && <Alerts />}
        {tab === "Pricing rules" && <Rules sources={props.sources} brands={props.brands} categories={props.categories} />}
        {tab === "Mapping" && <Mapping sites={props.sites} brands={["Bosch", "Neff", "Siemens"]} />}
        {tab === "Price history" && <History />}
      </div>
    </div>
  );
}
