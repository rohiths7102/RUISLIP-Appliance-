"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Notice, PageTitle, StatTile } from "@/components/admin/ui";
import type { BrandView, PendingChange, RunView, SiteView } from "@/lib/price-watch/pricewire";

/**
 * Admin → Pricewire: the sites prices can be read from (built in, or added by
 * the owner and tested before use), which site each of Bosch, Neff and
 * Siemens follows, the prices waiting to go on, and what the last runs did.
 * The morning run and n8n do the same read (lib/price-watch/pricewire.ts).
 */
export type PricewireLinks = { brands: string; priceWatch: string; categories: string };
type Msg = { tone: "success" | "warning" | "danger"; text: string } | null;

const money = (n: number | null | undefined) => (typeof n !== "number" ? "Call" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
const input = "mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm";
const STATUS: Record<string, string> = { not_listed: "not in their list", no_prices_in_list: "no prices found in the list", no_price: "no price on the page", discontinued: "no longer available", other_model: "the page is about another model", prices_disagree: "two different prices on the page" };

async function post(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
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
    const { ok, j } = await post("/api/admin/pricewire/test", "POST", { kind: f.kind, url: f.url, code });
    setBusy("");
    if (!ok) setMsg({ tone: "danger", text: j.error || "The test failed." }); else setTest(j);
  }
  async function save() {
    setBusy("save"); setMsg(null);
    const { ok, j } = await post("/api/admin/pricewire/sites", initial ? "PATCH" : "POST", initial ? { id: initial.id, ...f } : f);
    setBusy("");
    if (ok) onDone(); else setMsg({ tone: "danger", text: j.error || "Could not save." });
  }
  return (
    <div className="rounded-xl border border-line bg-paper-2/40 p-4">
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
        <label className="text-sm"><span className="font-medium text-ink">Test with a model</span><input value={code} onChange={(e) => setCode(e.target.value)} className={`${input} w-44 font-mono text-xs`} /></label>
        <Button small variant="secondary" onClick={runTest} disabled={!!busy || !f.url}>{busy === "test" ? "Reading…" : "Test this site"}</Button>
        <Button small onClick={save} disabled={!!busy || !f.url || !f.name}>{busy === "save" ? "Saving…" : initial ? "Save changes" : "Add site"}</Button>
        <Button small variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
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

function SiteRow({ s, onChange }: { s: SiteView; onChange: () => void }) {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  async function toggle() {
    setBusy(true); setMsg(null);
    const { ok, j } = await post("/api/admin/pricewire/sites", "PATCH", { id: s.id, enabled: !s.enabled });
    setBusy(false);
    if (ok) onChange(); else setMsg({ tone: "danger", text: j.error || "Could not save." });
  }
  async function remove() {
    if (!confirm(`Remove ${s.name}? Its past reads stay in Price watch.`)) return;
    setBusy(true); setMsg(null);
    const { ok, j } = await post("/api/admin/pricewire/sites", "DELETE", { id: s.id });
    setBusy(false);
    if (ok) onChange(); else setMsg({ tone: "danger", text: j.error || "Could not remove it." });
  }
  if (edit) return <SiteForm initial={s} onDone={() => { setEdit(false); onChange(); }} />;
  return (
    <div className={`rounded-xl border border-line p-4 ${s.enabled ? "bg-white" : "bg-paper-2/40 opacity-70"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
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
      {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
    </div>
  );
}

/* ------------------------------------------------------------ brands */

function BrandCard({ b, sites, links, onSaved }: { b: BrandView; sites: SiteView[]; links: PricewireLinks; onSaved: () => void }) {
  const [f, setF] = useState({ siteId: b.siteId, fallbackSiteId: b.fallbackSiteId, enabled: b.enabled });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const dirty = f.siteId !== b.siteId || f.fallbackSiteId !== b.fallbackSiteId || f.enabled !== b.enabled;
  const name = (id: string) => sites.find((s) => s.id === id)?.name || id;
  async function save() {
    setBusy(true); setMsg(null);
    const { ok, j } = await post("/api/admin/pricewire", "PATCH", { brand: b.brand, ...f });
    setBusy(false);
    if (ok) { setMsg({ tone: "success", text: "Saved. The next read uses this." }); onSaved(); } else setMsg({ tone: "danger", text: j.error || "Could not save." });
  }
  const siemensMaker = b.brand === "Siemens" && (f.siteId === "siemens-home" || f.fallbackSiteId === "siemens-home");
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">{b.brand}</h3>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> On</label>
      </div>
      <p className="mt-1 text-xs text-muted">{b.products} products · {b.mapped} with a price mapped · {b.unmapped} without · {b.showing} showing a price on the site</p>
      <label className="mt-4 block text-sm"><span className="font-medium text-ink">Prices from</span>
        <select value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })} className={input}>
          {sites.filter((s) => s.enabled || s.id === f.siteId).map((s) => <option key={s.id} value={s.id}>{s.name}{s.enabled ? "" : " (off)"}</option>)}
        </select></label>
      <label className="mt-3 block text-sm"><span className="font-medium text-ink">If {name(f.siteId)} has no price, try</span>
        <select value={f.fallbackSiteId} onChange={(e) => setF({ ...f, fallbackSiteId: e.target.value })} className={input}>
          <option value="">Nothing — keep the current price</option>
          {sites.filter((s) => s.id !== f.siteId && (s.enabled || s.id === f.fallbackSiteId)).map((s) => <option key={s.id} value={s.id}>{s.name}{s.enabled ? "" : " (off)"}</option>)}
        </select></label>
      {siemensMaker && <Notice tone="warning" className="mt-3">Siemens&apos; own UK site shows no prices, so it gives nothing.</Notice>}
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

export default function PricewireAdmin({ sites, brands, pending, runs, links }: { sites: SiteView[]; brands: BrandView[]; pending: PendingChange[]; runs: RunView[]; links: PricewireLinks }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "read" | "apply">("");
  const [msg, setMsg] = useState<Msg>(null);
  const [adding, setAdding] = useState(false);
  const [brand, setBrand] = useState("All");
  const [missingSite, setMissingSite] = useState("");
  const refresh = () => router.refresh();
  const shown = pending.filter((p) => brand === "All" || p.brand === brand);
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name || id;
  const listSites = sites.filter((s) => s.kind === "list" && s.notInCatalogue.length);
  const missing = sites.find((s) => s.id === missingSite)?.notInCatalogue ?? [];
  const manual = sites.filter((s) => s.enabled && !s.automatic);

  async function read() {
    setBusy("read"); setMsg(null);
    const { ok, j } = await post("/api/admin/pricewire/run", "POST");
    setBusy("");
    if (!ok) { setMsg({ tone: "danger", text: j.error || "The read failed. Try again in a minute." }); return; }
    const left = Object.values(j.brands as Record<string, any>).reduce((a: number, t: any) => a + t.left, 0);
    const unread = Object.values(j.brands as Record<string, any>).reduce((a: number, t: any) => a + t.unread, 0);
    const errors = Object.entries(j.sites as Record<string, any>).filter(([, t]) => t.error).map(([id, t]) => `${siteName(id)}: ${t.error}`);
    const priced = Object.entries(j.brands as Record<string, any>).map(([b, t]) => `${b} ${t.priced}/${t.products}`).join(", ");
    setMsg({ tone: errors.length ? "danger" : left ? "warning" : "success", text: `Priced ${priced} this read.${left ? ` ${left} product pages still to read — press Read prices now again.` : ""}${unread ? ` ${unread} pages could not be read (the site blocked us or was slow); those products keep their last price.` : ""}${errors.length ? ` Not read — ${errors.join("; ")}.` : ""}` });
    refresh();
  }
  async function apply() {
    if (!confirm(`Put ${pending.length} new prices on the website now?`)) return;
    setBusy("apply"); setMsg(null);
    const { ok, j } = await post("/api/admin/pricewire/apply", "POST");
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
      <PageTitle actions={<Button onClick={read} disabled={!!busy}>{busy === "read" ? "Reading… (up to a minute)" : "Read prices now"}</Button>}>Pricewire</PageTitle>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Maps a price onto every Bosch, Neff and Siemens product from the websites you choose. It runs early every morning and whenever n8n asks;
        {manual.length ? <> {manual.map((s) => s.name).join(" and ")} {manual.length > 1 ? "are" : "is"} on manual apply in <a className="underline" href={links.priceWatch}>Price watch</a>, so use Apply below for those.</> : " changes go on automatically with the usual safety checks."}
      </p>
      {msg && <Notice tone={msg.tone} className="mt-4">{msg.text}</Notice>}

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Sites" value={sites.filter((s) => s.enabled).length} hint={`${sites.length} set up`} />
        <StatTile label="Prices mapped" value={brands.reduce((a, b) => a + b.mapped, 0)} hint={`of ${brands.reduce((a, b) => a + b.products, 0)} products`} />
        <StatTile label="Waiting to go on" value={pending.length} hint={`${pending.filter((p) => p.from === null).length} first prices`} />
        <StatTile label="Sold by them, not by us" value={sites.reduce((a, s) => a + s.notInCatalogue.length, 0)} />
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-base font-semibold text-ink">Sites</h2><p className="text-xs text-muted">Where prices can be read from. Add any site, test it with a model number, then pick it for a brand below.</p></div>
          {!adding && <Button small variant="secondary" onClick={() => setAdding(true)}>Add a site</Button>}
        </div>
        <div className="mt-3 space-y-3">
          {adding && <SiteForm onDone={() => { setAdding(false); refresh(); }} />}
          {sites.map((s) => <SiteRow key={s.id} s={s} onChange={refresh} />)}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-ink">Brands</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">{brands.map((b) => <BrandCard key={b.brand} b={b} sites={sites} links={links} onSaved={refresh} />)}</div>
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
          <div className="mt-4 max-h-[520px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-muted"><tr><th className="py-2">Model</th><th>Product</th><th>From</th><th className="text-right">Now</th><th className="text-right">New</th></tr></thead>
              <tbody>{shown.slice(0, 400).map((p) => (
                <tr key={p.productId} className="border-t border-line">
                  <td className="py-1.5 font-mono text-xs">{p.code}</td>
                  <td className="max-w-[340px] truncate"><a href={`/products/${p.slug}`} target="_blank" rel="noreferrer" className="hover:underline">{p.title}</a></td>
                  <td><Badge tone="info">{siteName(p.siteId)}</Badge></td>
                  <td className="text-right text-muted">{money(p.from)}</td>
                  <td className="text-right font-semibold">{money(p.to)}</td>
                </tr>))}</tbody>
            </table>
            {shown.length > 400 && <p className="mt-2 text-xs text-muted">Showing 400 of {shown.length}.</p>}
          </div>
        ) : <p className="mt-4 text-sm text-muted">Nothing waiting: every mapped product shows its site&apos;s price.</p>}
      </Card>

      {listSites.length > 0 && (
        <Card className="mt-6 p-5">
          <h2 className="text-base font-semibold text-ink">Sold by them, not on our site</h2>
          <p className="text-xs text-muted">Bosch, Neff and Siemens models in a site&apos;s price list that aren&apos;t in our catalogue. Ask to have them added.</p>
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

      <Card className="mt-6 p-5">
        <h2 className="text-base font-semibold text-ink">Recent runs</h2>
        {runs.length ? (
          <ul className="mt-2 space-y-1 text-sm">{runs.map((r, i) => <li key={i} className="flex gap-3 border-t border-line py-1.5"><span className="shrink-0 text-muted">{when(r.at)}</span><span className="truncate">{r.by} — {r.summary || "read only"}</span></li>)}</ul>
        ) : <p className="mt-2 text-sm text-muted">No runs yet. Press Read prices now.</p>}
      </Card>
    </div>
  );
}
