"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Notice } from "@/components/admin/ui";
import type { BrandView, ChangeView, CheckLine, CheckView, PendingChange, RunView, SiteView } from "@/lib/price-watch/pricewire";

/**
 * Admin → Pricewire: the control room for Bosch, Neff and Siemens prices.
 *   top      coverage per brand, split by the site pricing each product
 *   brands   main and backup site per brand — only sites that passed their
 *            check for that brand can be picked
 *   sites    where prices can be read from, each checked per brand
 *   below    prices waiting (Apply), what changed lately, the last runs, and
 *            the models a list site sells that we don't
 * The morning run and n8n do the same read (lib/price-watch/pricewire.ts).
 */
export type PricewireLinks = { brands: string; priceWatch: string; categories: string };
type Msg = { tone: "success" | "warning" | "danger"; text: string } | null;
type Data = { sites: SiteView[]; brands: BrandView[]; pending: PendingChange[]; runs: RunView[]; checks: Record<string, CheckView>; coverage: Record<string, Record<string, number>>; changes: ChangeView[] };

const money = (n: number | null | undefined) => (typeof n !== "number" ? "Call" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
const input = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm";
const STATUS: Record<string, string> = { not_listed: "not in their list", no_prices_in_list: "no prices found in the list", no_price: "no price on the page", discontinued: "no longer available", other_model: "the page is about another model", prices_disagree: "two different prices on the page" };
const LINE: Record<CheckLine["status"], string> = { correct: "read correctly", wrong_price: "price too far from ours", wrong_model: "page is about another model", no_price: "no price", unread: "page would not load" };
// One colour per site in the coverage bars, in the order sites are listed.
const SITE_COLOURS = ["#ffffff", "#7fb3e0", "#3b82c4", "#a5b4fc", "#5eead4", "#94a3b8"];
const FEED_BRANDS = ["Bosch", "Neff", "Siemens"] as const;

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}

/* ------------------------------------------------------------ checks */

function CheckChip({ siteId, brand, check, onDone }: { siteId: string; brand: string; check?: CheckView; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  async function run() {
    setBusy(true); setErr("");
    const { ok, j } = await call("/api/admin/pricewire/check", "POST", { siteId, brand });
    setBusy(false);
    if (!ok) setErr(j.error || "The check failed."); else { setOpen(true); onDone(); }
  }
  const tone = !check ? "neutral" : check.passed && check.fresh ? "success" : check.passed ? "warning" : "danger";
  const label = !check ? "not checked" : check.passed ? (check.fresh ? "passed" : "check expired") : "failed";
  return (
    <div className="rounded-lg border border-line px-2.5 py-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-ink">{brand}</span>
        <Badge tone={tone as any}>{label}</Badge>
        {check && <button type="button" onClick={() => setOpen(!open)} className="text-muted underline-offset-2 hover:underline">{open ? "hide" : "details"}</button>}
        <button type="button" onClick={run} disabled={busy} className="ml-auto font-medium text-blue-deep hover:underline disabled:opacity-50">{busy ? "Checking…" : "Check"}</button>
      </div>
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
      {open && check && (
        <div className="mt-2 text-xs">
          <p className="text-muted">{check.summary} · {when(check.checkedAt)}</p>
          <ul className="mt-1 space-y-0.5">
            {check.lines.map((l) => (
              <li key={l.code} className="flex gap-2">
                <span className={l.status === "correct" ? "text-success" : l.status === "wrong_price" || l.status === "wrong_model" ? "text-danger" : "text-muted"}>{l.status === "correct" ? "✓" : l.status === "wrong_price" || l.status === "wrong_model" ? "✗" : "–"}</span>
                <span className="font-mono">{l.code}</span><span className="text-muted">ours {money(l.ours)} · read {l.read === null ? "—" : money(l.read)} · {LINE[l.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- sites */

function SiteForm({ initial, onDone }: { initial?: SiteView; onDone: () => void }) {
  const [f, setF] = useState({ name: initial?.name ?? "", kind: initial?.kind ?? "page", url: initial?.url ?? "" });
  const [code, setCode] = useState("WGG254Z1GB");
  const [test, setTest] = useState<any>(null);
  const [busy, setBusy] = useState<"" | "test" | "save">("");
  const [msg, setMsg] = useState<Msg>(null);
  async function runTest() {
    setBusy("test"); setMsg(null); setTest(null);
    const { ok, j } = await call("/api/admin/pricewire/test", "POST", { kind: f.kind, url: f.url, code });
    setBusy("");
    if (!ok) setMsg({ tone: "danger", text: j.error || "The test failed." }); else setTest(j);
  }
  async function save() {
    setBusy("save"); setMsg(null);
    const { ok, j } = await call("/api/admin/pricewire/sites", initial ? "PATCH" : "POST", initial ? { id: initial.id, ...f } : f);
    setBusy("");
    if (ok) onDone(); else setMsg({ tone: "danger", text: j.error || "Could not save." });
  }
  return (
    <div className="rounded-xl border border-blue/30 bg-paper-2/40 p-4">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_2fr]">
        <label className="text-sm"><span className="font-medium text-ink">Site name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={input} placeholder="e.g. Marks Electrical" disabled={initial?.builtIn} /></label>
        <label className="text-sm"><span className="font-medium text-ink">What it gives</span>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={input} disabled={initial?.builtIn}>
            <option value="page">Product pages</option><option value="list">A price list (one line per model)</option>
          </select></label>
        <label className="text-sm"><span className="font-medium text-ink">Address</span>
          <input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} className={`${input} font-mono text-xs`} placeholder={f.kind === "page" ? "https://www.example.co.uk/products/{code}" : "https://www.example.co.uk/price-list.txt"} />
          {f.kind === "page" && <span className="mt-1 block text-xs text-muted">Put <code>{"{code}"}</code> where the model number goes.</span>}</label>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="font-medium text-ink">Try one model</span><input value={code} onChange={(e) => setCode(e.target.value)} className={`${input} w-44 font-mono text-xs`} /></label>
        <Button small variant="secondary" onClick={runTest} disabled={!!busy || !f.url}>{busy === "test" ? "Reading…" : "Try it"}</Button>
        <Button small onClick={save} disabled={!!busy || !f.url || !f.name}>{busy === "save" ? "Saving…" : initial ? "Save changes" : "Add site"}</Button>
        <Button small variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      <p className="mt-2 text-xs text-muted">After saving, press Check for each brand. A site can only be picked for a brand once its check has passed.</p>
      {test && (
        <Notice tone={typeof test.price === "number" ? "success" : "warning"} className="mt-3">
          {typeof test.price === "number"
            ? <>{code}: <b>{money(test.price)}</b>{test.inStock === true ? ", in stock" : test.inStock === false ? ", not in stock" : ""}{test.title ? ` — ${test.title}` : ""}{typeof test.listed === "number" ? ` (${test.listed} models in the list)` : ""}</>
            : <>{code}: no price — {STATUS[test.status] || test.status}. {typeof test.listed === "number" && test.listed > 0 ? `The list itself read fine (${test.listed} models).` : "Check the address."}</>}
        </Notice>
      )}
      {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
    </div>
  );
}

function SiteRow({ s, colour, checks, onChange }: { s: SiteView; colour: string; checks: Record<string, CheckView>; onChange: () => void }) {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  async function toggle() {
    setBusy(true); setMsg(null);
    const { ok, j } = await call("/api/admin/pricewire/sites", "PATCH", { id: s.id, enabled: !s.enabled });
    setBusy(false);
    if (ok) onChange(); else setMsg({ tone: "danger", text: j.error || "Could not save." });
  }
  async function remove() {
    if (!confirm(`Remove ${s.name}? Its past reads stay in Price watch.`)) return;
    setBusy(true); setMsg(null);
    const { ok, j } = await call("/api/admin/pricewire/sites", "DELETE", { id: s.id });
    setBusy(false);
    if (ok) onChange(); else setMsg({ tone: "danger", text: j.error || "Could not remove it." });
  }
  if (edit) return <SiteForm initial={s} onDone={() => { setEdit(false); onChange(); }} />;
  return (
    <div className={`rounded-xl border border-line p-4 ${s.enabled ? "bg-white" : "bg-paper-2/40 opacity-70"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full ring-1 ring-navy/20" style={{ background: colour }} aria-hidden />
            <span className="font-semibold text-ink">{s.name}</span>
            <Badge tone={s.kind === "list" ? "info" : "neutral"}>{s.kind === "list" ? "price list" : "product pages"}</Badge>
            {!s.enabled && <Badge tone="warning">off</Badge>}
            {s.enabled && !s.automatic && <Badge tone="warning">manual apply</Badge>}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-muted">{s.url}</div>
          <div className="mt-1 text-xs text-muted">
            {s.usedBy.length ? `Used by ${s.usedBy.join(", ")}` : "Not used by any brand"} · prices {s.followers} products · last read {when(s.lastReadAt)}{s.lastReadSummary ? `: ${s.lastReadSummary}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button small variant="secondary" onClick={() => setEdit(true)} disabled={busy}>Edit</Button>
          <Button small variant="secondary" onClick={toggle} disabled={busy}>{s.enabled ? "Switch off" : "Switch on"}</Button>
          {!s.builtIn && <Button small variant="danger" onClick={remove} disabled={busy}>Remove</Button>}
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {FEED_BRANDS.map((b) => <CheckChip key={b} siteId={s.id} brand={b} check={checks[`${s.id}|${b}`]} onDone={onChange} />)}
      </div>
      {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
    </div>
  );
}

/* ------------------------------------------------------------ brands */

function BrandCard({ b, sites, checks, links, onSaved }: { b: BrandView; sites: SiteView[]; checks: Record<string, CheckView>; links: PricewireLinks; onSaved: () => void }) {
  const [f, setF] = useState({ siteId: b.siteId, fallbackSiteId: b.fallbackSiteId, enabled: b.enabled });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const dirty = f.siteId !== b.siteId || f.fallbackSiteId !== b.fallbackSiteId || f.enabled !== b.enabled;
  const name = (id: string) => sites.find((s) => s.id === id)?.name || id;
  // Only a site that passed its check for this brand can be picked; the ones already in use stay selectable.
  const passed = (s: SiteView) => !!checks[`${s.id}|${b.brand}`]?.passed && !!checks[`${s.id}|${b.brand}`]?.fresh;
  const pickable = (s: SiteView) => s.id === b.siteId || s.id === b.fallbackSiteId || (s.enabled && passed(s));
  const tag = (s: SiteView) => (!s.enabled ? " (off)" : passed(s) ? " ✓ checked" : s.id === b.siteId || s.id === b.fallbackSiteId ? "" : " — check it first");
  async function save() {
    setBusy(true); setMsg(null);
    const { ok, j } = await call("/api/admin/pricewire", "PATCH", { brand: b.brand, ...f });
    setBusy(false);
    if (ok) { setMsg({ tone: "success", text: "Saved. The next read uses this." }); onSaved(); } else setMsg({ tone: "danger", text: j.error || "Could not save." });
  }
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">{b.brand}</h3>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> On</label>
      </div>
      <label className="mt-3 block text-sm"><span className="font-medium text-ink">Prices from</span>
        <select value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })} className={input}>
          {sites.map((s) => <option key={s.id} value={s.id} disabled={!pickable(s)}>{s.name}{tag(s)}</option>)}
        </select></label>
      <label className="mt-3 block text-sm"><span className="font-medium text-ink">If {name(f.siteId)} has no price, try</span>
        <select value={f.fallbackSiteId} onChange={(e) => setF({ ...f, fallbackSiteId: e.target.value })} className={input}>
          <option value="">Nothing — keep the current price</option>
          {sites.filter((s) => s.id !== f.siteId).map((s) => <option key={s.id} value={s.id} disabled={!pickable(s)}>{s.name}{tag(s)}</option>)}
        </select></label>
      {b.callForPrice && <Notice tone="warning" className="mt-3">{b.brand} is set to <b>Call for price</b> in <a className="underline" href={links.brands}>Brands</a>, so its prices stay hidden until you untick that.</Notice>}
      {b.hiddenByCategory > 0 && <p className="mt-3 text-xs text-muted">{b.hiddenByCategory} mapped prices are in categories set to Call for price in <a className="underline" href={links.categories}>Categories</a> (accessories and spare parts), so they stay hidden.</p>}
      {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-muted">Last run {when(b.lastRunAt)}{b.lastRunSummary ? `: ${b.lastRunSummary}` : ""}</span>
        <Button small onClick={save} disabled={!dirty || busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- page */

export default function PricewireAdmin({ sites, brands, pending, runs, checks, coverage, changes, links }: Data & { links: PricewireLinks }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "read" | "apply">("");
  const [msg, setMsg] = useState<Msg>(null);
  const [adding, setAdding] = useState(false);
  const [brand, setBrand] = useState("All");
  const [missingSite, setMissingSite] = useState("");
  const refresh = () => router.refresh();
  const colourOf = (id: string) => SITE_COLOURS[Math.max(0, sites.findIndex((s) => s.id === id)) % SITE_COLOURS.length];
  const shown = pending.filter((p) => brand === "All" || p.brand === brand);
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name || id;
  const listSites = sites.filter((s) => s.kind === "list" && s.notInCatalogue.length);
  const missing = sites.find((s) => s.id === missingSite)?.notInCatalogue ?? [];
  const manual = sites.filter((s) => s.enabled && !s.automatic);
  const products = brands.reduce((a, b) => a + b.products, 0);
  const mapped = brands.reduce((a, b) => a + b.mapped, 0);
  const lastRun = runs[0];

  async function read() {
    setBusy("read"); setMsg(null);
    const { ok, j } = await call("/api/admin/pricewire/run", "POST");
    setBusy("");
    if (!ok) { setMsg({ tone: "danger", text: j.error || "The read failed. Try again in a minute." }); return; }
    const sum = (k: string) => Object.values(j.brands as Record<string, any>).reduce((a: number, t: any) => a + (t[k] || 0), 0);
    const errors = Object.entries(j.sites as Record<string, any>).filter(([, t]) => t.error).map(([id, t]) => `${siteName(id)}: ${t.error}`);
    const priced = Object.entries(j.brands as Record<string, any>).map(([b, t]) => `${b} ${t.priced}/${t.products}`).join(", ");
    setMsg({ tone: errors.length ? "danger" : sum("left") ? "warning" : "success",
      text: `Priced ${priced} this read.${sum("left") ? ` ${sum("left")} product pages still to read — press Read prices now again.` : ""}${sum("unread") ? ` ${sum("unread")} pages could not be read; those products keep their last price.` : ""}${errors.length ? ` ${errors.join("; ")}.` : ""}` });
    refresh();
  }
  async function apply() {
    if (!confirm(`Put ${pending.length} new prices on the website now?`)) return;
    setBusy("apply"); setMsg(null);
    const { ok, j } = await call("/api/admin/pricewire/apply", "POST");
    setBusy("");
    if (!ok) { setMsg({ tone: "danger", text: j.error || "Apply failed." }); return; }
    const held: Record<string, number> = {};
    for (const x of Object.values(j.result as Record<string, any>)) for (const [k, n] of Object.entries(x.held as Record<string, number>)) held[k] = (held[k] || 0) + n;
    const reasons: Record<string, string> = { poa_category: "in a call-for-price category or brand", implausible_move: "too big a move for one read", unconfirmed_match: "not a confirmed match", stale_observation: "read too long ago" };
    const heldText = Object.entries(held).map(([k, n]) => `${n} ${reasons[k] || k.replace(/_/g, " ")}`).join(", ");
    setMsg({ tone: heldText ? "warning" : "success", text: `${j.changed} prices updated on the website.${heldText ? ` Held back: ${heldText}.` : ""}` });
    refresh();
  }

  return (
    <div className="max-w-6xl">
      {/* ---- control room: what is priced, by which site, right now ---- */}
      <section className="overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0d2949_0%,#163d6b_60%,#1b3e7b_100%)] p-6 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Pricewire</h1>
            <p className="mt-1 max-w-xl text-sm text-white/70">Bosch, Neff and Siemens prices, mapped from the sites you choose. Runs early every morning and whenever n8n asks.</p>
          </div>
          <button type="button" onClick={read} disabled={!!busy} className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#0d2949] hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60">
            {busy === "read" ? "Reading… (up to a minute)" : "Read prices now"}
          </button>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Prices mapped", mapped.toLocaleString("en-GB"), `of ${products.toLocaleString("en-GB")} products`],
            ["Waiting to go on", String(pending.length), `${pending.filter((p) => p.from === null).length} first prices`],
            ["Sites in use", String(sites.filter((s) => s.usedBy.length).length), `${sites.length} set up`],
            ["Last run", lastRun ? when(lastRun.at) : "never", lastRun ? lastRun.by.replace(/^price-agent \(|\)$/g, "") : "press Read prices now"],
          ].map(([k, v, h]) => (
            <div key={k} className="rounded-xl bg-white/[.07] p-3 ring-1 ring-white/10">
              <div className="text-xs text-white/60">{k}</div>
              <div className="mt-1 truncate text-2xl font-semibold tabular-nums">{v}</div>
              <div className="truncate text-xs text-white/50">{h}</div>
            </div>
          ))}
        </div>
        <div className="mt-6 space-y-3">
          {brands.map((b) => {
            const by = coverage[b.brand] || {};
            const total = b.products || 1;
            return (
              <div key={b.brand}>
                <div className="flex justify-between gap-3 text-xs text-white/70"><span className="font-medium text-white">{b.brand}</span><span>{b.mapped} of {b.products} priced{b.callForPrice ? " · brand set to call for price" : ""}</span></div>
                <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${b.brand}: ${sites.filter((s) => by[s.id]).map((s) => `${by[s.id]} from ${s.name}`).join(", ") || "none priced"}`}>
                  {sites.filter((s) => by[s.id]).map((s) => <span key={s.id} title={`${s.name}: ${by[s.id]}`} style={{ width: `${(by[s.id] / total) * 100}%`, background: colourOf(s.id) }} />)}
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-4 pt-1 text-xs text-white/70">
            {sites.filter((s) => s.followers).map((s) => <span key={s.id} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: colourOf(s.id) }} />{s.name}</span>)}
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-white/10 ring-1 ring-white/20" />no price found</span>
          </div>
        </div>
      </section>
      {manual.length > 0 && <Notice tone="warning" className="mt-4">{manual.map((s) => s.name).join(" and ")} {manual.length > 1 ? "are" : "is"} on manual apply in <a className="underline" href={links.priceWatch}>Price watch</a>; use Apply below for those.</Notice>}
      {msg && <Notice tone={msg.tone} className="mt-4">{msg.text}</Notice>}

      <section className="mt-8">
        <h2 className="text-base font-semibold text-ink">Brands</h2>
        <p className="text-xs text-muted">Pick where each brand&apos;s prices come from. Only sites that passed their check for that brand can be picked.</p>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">{brands.map((b) => <BrandCard key={b.brand} b={b} sites={sites} checks={checks} links={links} onSaved={refresh} />)}</div>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-base font-semibold text-ink">Sites</h2><p className="text-xs text-muted">Where prices can be read from. Check reads a site live on a brand&apos;s products and decides whether it can be used for that brand.</p></div>
          {!adding && <Button small variant="secondary" onClick={() => setAdding(true)}>Add a site</Button>}
        </div>
        <div className="mt-3 space-y-3">
          {adding && <SiteForm onDone={() => { setAdding(false); refresh(); }} />}
          {sites.map((s) => <SiteRow key={s.id} s={s} colour={colourOf(s.id)} checks={checks} onChange={refresh} />)}
        </div>
      </section>

      <Card className="mt-8 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-semibold text-ink">Prices waiting to go on</h2><p className="text-xs text-muted">What each product will show after Apply, from the site it follows.</p></div>
          <div className="flex items-center gap-2">
            <select value={brand} onChange={(e) => setBrand(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-sm">{["All", ...brands.map((b) => b.brand)].map((x) => <option key={x}>{x}</option>)}</select>
            <Button onClick={apply} disabled={!!busy || !pending.length}>{busy === "apply" ? "Applying…" : `Apply ${pending.length} prices`}</Button>
          </div>
        </div>
        {shown.length ? (
          <div className="mt-4 max-h-[460px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-muted"><tr><th className="py-2">Model</th><th>Product</th><th>From</th><th className="text-right">Now</th><th className="text-right">New</th></tr></thead>
              <tbody>{shown.slice(0, 400).map((p) => (
                <tr key={p.productId} className="border-t border-line">
                  <td className="py-1.5 font-mono text-xs">{p.code}</td>
                  <td className="max-w-[340px] truncate"><a href={`/products/${p.slug}`} target="_blank" rel="noreferrer" className="hover:underline">{p.title}</a></td>
                  <td className="text-xs">{siteName(p.siteId)}</td>
                  <td className="text-right text-muted">{money(p.from)}</td>
                  <td className="text-right font-semibold">{money(p.to)}</td>
                </tr>))}</tbody>
            </table>
            {shown.length > 400 && <p className="mt-2 text-xs text-muted">Showing 400 of {shown.length}.</p>}
          </div>
        ) : <p className="mt-4 text-sm text-muted">Nothing waiting: every mapped product shows its site&apos;s price.</p>}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-base font-semibold text-ink">Latest price changes</h2>
          {changes.length ? (
            <ul className="mt-2 max-h-[360px] overflow-auto text-sm">
              {changes.map((c, i) => (
                <li key={i} className="flex items-center gap-3 border-t border-line py-1.5">
                  <span className="w-24 shrink-0 text-xs text-muted">{when(c.at)}</span>
                  <a href={`/products/${c.slug}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline"><span className="font-mono text-xs">{c.code}</span> {c.title}</a>
                  <span className="shrink-0 text-xs text-muted">{money(c.from)} →</span>
                  <span className={`shrink-0 font-semibold ${typeof c.from === "number" && typeof c.to === "number" && c.to < c.from ? "text-success" : "text-ink"}`}>{money(c.to)}</span>
                </li>))}
            </ul>
          ) : <p className="mt-2 text-sm text-muted">No changes yet.</p>}
        </Card>
        <Card className="p-5">
          <h2 className="text-base font-semibold text-ink">Recent runs</h2>
          {runs.length ? (
            <ul className="mt-2 text-sm">{runs.map((r, i) => <li key={i} className="flex gap-3 border-t border-line py-1.5"><span className="w-24 shrink-0 text-xs text-muted">{when(r.at)}</span><span className="min-w-0 truncate">{r.by} — {r.summary || "read only"}</span></li>)}</ul>
          ) : <p className="mt-2 text-sm text-muted">No runs yet. Press Read prices now.</p>}
        </Card>
      </div>

      {listSites.length > 0 && (
        <Card className="mt-6 p-5">
          <h2 className="text-base font-semibold text-ink">Sold by them, not on our site</h2>
          <p className="text-xs text-muted">Bosch, Neff and Siemens models in a site&apos;s price list that aren&apos;t in our catalogue.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {listSites.map((s) => <Button key={s.id} small variant={missingSite === s.id ? "primary" : "secondary"} onClick={() => setMissingSite(missingSite === s.id ? "" : s.id)}>{s.name}: {s.notInCatalogue.length}</Button>)}
          </div>
          {missing.length > 0 && (
            <ul className="mt-4 max-h-[420px] space-y-1 overflow-auto text-sm">
              {missing.map((m) => (
                <li key={m.code} className="flex justify-between gap-4 border-t border-line py-1.5">
                  <a href={m.url} target="_blank" rel="noreferrer" className="truncate hover:underline"><span className="font-mono text-xs">{m.code}</span> · {m.brand} · {m.title}</a>
                  <span className="shrink-0 text-muted">{m.section} · {money(m.price)}</span>
                </li>))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
