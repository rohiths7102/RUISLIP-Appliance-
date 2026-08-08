"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Search, Trash2, Upload, X, ExternalLink, Download, FileUp } from "lucide-react";
import { Badge, Button, Card, Notice, PageTitle } from "@/components/admin/ui";

type ImportPreview = {
  rows: number; updates: number; creates: number; unchanged: number;
  errors: string[]; errorCount: number;
  sample: { code: string; fields: { field: string; from: any; to: any }[] }[];
};

type Row = {
  id: string; title: string; brand: string; productCode: string;
  category: string; subcategory: string; slug?: string;
  priceNow: number | null; priceWas: number | null;
  availabilityNormalised: string; warranty: string; shortDescription: string;
  deliveryNotes: string;
  mainImage: string; isVisible: boolean; featured: boolean; adminOverrideFields: string[];
};

const AVAIL = [
  ["in_stock", "In stock"],
  ["limited", "Limited availability"],
  ["awaiting_stock", "Awaiting stock"],
  ["call_to_confirm", "Call to confirm"],
  ["unavailable", "Unavailable"],
];
const PER_PAGE = 25;
const blank = (): Row => ({
  id: "", title: "", brand: "", productCode: "", category: "", subcategory: "", priceNow: null, priceWas: null,
  availabilityNormalised: "call_to_confirm", warranty: "", shortDescription: "", deliveryNotes: "", mainImage: "",
  isVisible: true, featured: false, adminOverrideFields: [],
});

export default function ProductsAdmin({
  initial, initialTotal, categories,
}: { initial: Row[]; initialTotal: number; categories: { name: string; subs: string[] }[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [total, setTotal] = useState(initialTotal);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStock, setBulkStock] = useState("in_stock");
  const [bulkPct, setBulkPct] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [importCsv, setImportCsv] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  // Server-side search/paging: 1,577 rows must not all ship to the browser.
  const load = useCallback(async (query: string, p: number) => {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`/api/admin/products?q=${encodeURIComponent(query)}&take=${PER_PAGE}&skip=${(p - 1) * PER_PAGE}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const j = await r.json();
      setRows(j.rows); setTotal(j.total);
    } catch (e: any) { setErr(e.message || "Could not load products"); }
    finally { setLoading(false); }
  }, []);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => load(q, page), 250);
    return () => clearTimeout(t);
  }, [q, page, load]);
  useEffect(() => { setPage(1); }, [q]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3500); };

  async function save() {
    // The guard + in-flight state stop a double-click on "Add product" from
    // POSTing twice — the API auto-suffixes slugs, so the duplicate would be
    // accepted silently and go live.
    if (!editing || saving) return;
    setSaving(true);
    setErr("");
    try {
    const body = {
      title: editing.title, brand: editing.brand, productCode: editing.productCode,
      category: editing.category, subcategory: editing.subcategory,
      priceNow: editing.priceNow, priceWas: editing.priceWas,
      availabilityNormalised: editing.availabilityNormalised, warranty: editing.warranty,
      shortDescription: editing.shortDescription, deliveryNotes: editing.deliveryNotes,
      mainImage: editing.mainImage,
      isVisible: editing.isVisible, featured: editing.featured,
    };
    const r = await fetch(isNew ? "/api/admin/products" : `/api/admin/products/${editing.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error || "Save failed"); return; }
    setEditing(null);
    flash(isNew ? "Product added — it's live on the site now" : "Saved — live on the site now");
    load(q, page);
    } finally { setSaving(false); }
  }

  async function remove(row: Row) {
    if (!confirm(`Delete "${row.title}" (${row.productCode})?\n\nThis removes it from the website immediately and cannot be undone.`)) return;
    const r = await fetch(`/api/admin/products/${row.id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error || "Delete failed"); return; }
    flash("Deleted — removed from the site");
    load(q, page);
  }

  /** Inline stock change straight from the table — the most common daily job. */
  async function setStock(row: Row, value: string) {
    setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, availabilityNormalised: value } : x)));
    const r = await fetch(`/api/admin/products/${row.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ availabilityNormalised: value }),
    });
    if (!r.ok) { setErr("Could not update stock"); load(q, page); } else flash(`Stock updated for ${row.productCode}`);
  }

  /** CSV import — always preview (dry-run diff) first, apply only on confirm. */
  async function pickImportFile(file?: File) {
    if (!file) return;
    setErr("");
    if (file.size > 2 * 1024 * 1024) { setErr("CSV too large (max 2MB)"); return; }
    const text = await file.text();
    setImportBusy(true);
    try {
      const r = await fetch("/api/admin/products/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text, mode: "preview" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setImportCsv(text);
      setImportPreview(j);
    } catch (e: any) { setErr(e.message || "Could not read that CSV"); }
    finally { setImportBusy(false); }
  }
  async function applyImport() {
    if (!importCsv || importBusy) return;
    setImportBusy(true); setErr("");
    try {
      const r = await fetch("/api/admin/products/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: importCsv, mode: "apply" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      flash(`Imported: ${j.updates} updated, ${j.creates} added — live now`);
      setImportCsv(null); setImportPreview(null);
      load(q, page);
    } catch (e: any) { setErr(e.message || "Import failed"); }
    finally { setImportBusy(false); }
  }

  /** Bulk operation over the selected rows — one audited call, then reload. */
  async function bulk(action: string, value: unknown) {
    if (!selected.size || bulkBusy) return;
    setBulkBusy(true); setErr("");
    try {
      const r = await fetch("/api/admin/products/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], action, value }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      flash(`Updated ${j.updated} product${j.updated === 1 ? "" : "s"}${j.skipped ? ` (${j.skipped} skipped)` : ""} — live now`);
      setSelected(new Set());
      load(q, page);
    } catch (e: any) { setErr(e.message || "Bulk update failed"); }
    finally { setBulkBusy(false); }
  }
  const toggleSel = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pageAllSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (pageAllSelected) rows.forEach((r) => n.delete(r.id));
      else rows.forEach((r) => n.add(r.id));
      return n;
    });

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const input = "w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-blue";

  return (
    <div>
      <PageTitle
        actions={
          <>
            {msg && <span className="text-sm font-medium text-success">{msg}</span>}
            <a href="/api/admin/products/export" download
              className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold hover:border-blue hover:text-blue-deep">
              <Download size={15} /> Export CSV
            </a>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold hover:border-blue hover:text-blue-deep">
              <FileUp size={15} /> {importBusy && !importPreview ? "Reading…" : "Import CSV"}
              <input type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => { pickImportFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <Button onClick={() => { setEditing(blank()); setIsNew(true); setErr(""); }}
              className="inline-flex items-center gap-2">
              <Plus size={15} /> Add product
            </Button>
          </>
        }
      >
        Products <span className="text-sm font-normal text-muted">({total.toLocaleString("en-GB")})</span>
      </PageTitle>

      {err && <Notice tone="danger" className="mt-3">{err}</Notice>}

      <div className="relative mt-4 max-w-md">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all products by name, brand or code…"
          className="w-full rounded-full border border-line py-2 pl-9 pr-3 text-sm outline-none focus:border-blue" />
      </div>

      {selected.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-xl bg-navy px-4 py-3 text-paper">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <span className="mx-1 h-5 w-px bg-white/20" />
          <select value={bulkStock} onChange={(e) => setBulkStock(e.target.value)} aria-label="Bulk stock state"
            className="rounded-lg border border-white/20 bg-navy-2 px-2 py-1.5 text-xs text-paper outline-none">
            <option value="in_stock">In stock</option>
            <option value="limited">Limited availability</option>
            <option value="awaiting_stock">Awaiting stock</option>
            <option value="call_to_confirm">Call to confirm</option>
            <option value="unavailable">Unavailable</option>
          </select>
          <button onClick={() => bulk("set_stock", bulkStock)} disabled={bulkBusy}
            className="rounded-lg bg-blue px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Set stock</button>
          <span className="mx-1 h-5 w-px bg-white/20" />
          <input value={bulkPct} onChange={(e) => setBulkPct(e.target.value)} placeholder="e.g. 5 or -10"
            aria-label="Price adjustment percent"
            className="w-24 rounded-lg border border-white/20 bg-navy-2 px-2 py-1.5 text-xs text-paper outline-none placeholder:text-white/40" />
          <button onClick={() => bulk("adjust_price", Number(bulkPct))} disabled={bulkBusy || bulkPct === ""}
            className="rounded-lg bg-blue px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Adjust price %</button>
          <span className="mx-1 h-5 w-px bg-white/20" />
          <button onClick={() => bulk("set_visible", false)} disabled={bulkBusy}
            className="rounded-lg border border-white/25 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Hide</button>
          <button onClick={() => bulk("set_visible", true)} disabled={bulkBusy}
            className="rounded-lg border border-white/25 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Show</button>
          <button onClick={() => bulk("set_featured", true)} disabled={bulkBusy}
            className="rounded-lg border border-white/25 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Feature</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-white/60 hover:text-white">Clear</button>
        </div>
      )}

      <Card className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-paper-2 text-left text-ink/60">
            <tr>
              <th className="w-10 p-3">
                <input type="checkbox" checked={pageAllSelected} onChange={toggleAll} aria-label="Select all on this page" className="cursor-pointer" />
              </th>
              <th className="p-3 w-14"></th>
              <th className="p-3">Code</th>
              <th className="p-3">Product</th>
              <th className="p-3">Price</th>
              <th className="p-3">Stock</th>
              <th className="p-3">Live</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-line align-middle ${selected.has(r.id) ? "bg-blue/[.06]" : ""}`}>
                <td className="p-3">
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)}
                    aria-label={`Select ${r.productCode}`} className="cursor-pointer" />
                </td>
                <td className="p-2">
                  <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded border border-line bg-white">
                    {r.mainImage
                      /* eslint-disable-next-line @next/next/no-img-element */
                      ? <img src={r.mainImage} alt="" className="h-full w-full object-contain p-0.5" />
                      : <span className="text-[9px] text-ink/30">none</span>}
                  </div>
                </td>
                <td className="p-3 font-mono text-xs">{r.productCode}</td>
                <td className="p-3">
                  <div className="font-medium leading-tight">{r.title}</div>
                  <div className="text-xs text-ink/45">
                    {r.brand} · {r.subcategory || r.category || "—"}
                    {r.adminOverrideFields?.length ? <span className="ml-2 rounded bg-blue/20 px-1.5 py-0.5 text-[10px] text-navy">edited</span> : null}
                  </div>
                </td>
                <td className="p-3 whitespace-nowrap">{r.priceNow === null ? <span className="text-ink/40">Call</span> : `£${r.priceNow}`}</td>
                <td className="p-3">
                  <select value={r.availabilityNormalised} onChange={(e) => setStock(r, e.target.value)}
                    aria-label={`Stock for ${r.productCode}`}
                    className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-blue">
                    {AVAIL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </td>
                <td className="p-3">{r.isVisible ? <Badge tone="success">Yes</Badge> : <Badge tone="neutral">Hidden</Badge>}</td>
                <td className="p-3 whitespace-nowrap text-right">
                  {r.slug && (
                    <a href={`/products/${r.slug}`} target="_blank" rel="noopener noreferrer" title="View on site"
                      className="mr-1 inline-flex rounded p-2 text-ink/40 hover:text-blue"><ExternalLink size={14} /></a>
                  )}
                  <button onClick={() => { setEditing(r); setIsNew(false); setErr(""); }}
                    className="rounded-full border border-navy/20 px-3 py-1.5 text-xs hover:border-blue">Edit</button>
                  <button onClick={() => remove(r)} aria-label={`Delete ${r.productCode}`}
                    className="ml-1 rounded p-2 text-ink/40 hover:text-danger"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="p-4 text-center text-sm text-ink/40">Loading…</div>}
        {!loading && !rows.length && <div className="p-10 text-center text-sm text-ink/40">No products match “{q}”.</div>}
      </Card>

      {pages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button variant="secondary" small onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <span className="px-2 text-xs text-muted">Page {page} of {pages}</span>
          <Button variant="secondary" small onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}>Next</Button>
        </div>
      )}

      {editing && (
        <Editor
          row={editing} isNew={isNew} categories={categories} input={input} error={err} saving={saving}
          onChange={setEditing} onClose={() => setEditing(null)} onSave={save}
        />
      )}

      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10"
          onClick={() => { setImportPreview(null); setImportCsv(null); }}>
          <div className="w-full max-w-xl rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl font-semibold">Import preview</h2>
            <p className="mt-1 text-sm text-muted">Nothing has been written yet — this is exactly what applying will do.</p>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[["Rows", importPreview.rows], ["Will update", importPreview.updates], ["Will add", importPreview.creates], ["Unchanged", importPreview.unchanged]].map(([l, n]) => (
                <div key={l as string} className="rounded-xl border border-line p-3 text-center">
                  <div className="font-display text-2xl font-semibold text-navy">{n as number}</div>
                  <div className="text-[11px] text-muted">{l}</div>
                </div>
              ))}
            </div>

            {importPreview.errorCount > 0 && (
              <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs text-danger">
                <strong>{importPreview.errorCount} row{importPreview.errorCount === 1 ? "" : "s"} with problems</strong> (import is blocked until fixed):
                <ul className="mt-1 list-inside list-disc">
                  {importPreview.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}

            {importPreview.sample.length > 0 && (
              <div className="mt-4 max-h-52 overflow-y-auto rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-paper-2 text-left text-ink/60">
                    <tr><th className="p-2">Code</th><th className="p-2">Change</th></tr>
                  </thead>
                  <tbody>
                    {importPreview.sample.map((s, i) => (
                      <tr key={i} className="border-t border-line align-top">
                        <td className="p-2 font-mono">{s.code}</td>
                        <td className="p-2">
                          {s.fields.map((f) => (
                            <div key={f.field}>
                              <span className="text-ink/60">{f.field}:</span>{" "}
                              <span className="text-ink/40 line-through">{String(f.from ?? "—")}</span>{" "}
                              → <strong>{String(f.to ?? "—")}</strong>
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setImportPreview(null); setImportCsv(null); }}>Cancel</Button>
              <Button onClick={applyImport}
                disabled={importBusy || importPreview.errorCount > 0 || (importPreview.updates + importPreview.creates === 0)}>
                {importBusy ? "Applying…" : `Apply ${importPreview.updates + importPreview.creates} change${importPreview.updates + importPreview.creates === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Editor({
  row, isNew, categories, input, error, saving, onChange, onClose, onSave,
}: {
  row: Row; isNew: boolean; categories: { name: string; subs: string[] }[]; input: string; error: string; saving: boolean;
  onChange: (r: Row) => void; onClose: () => void; onSave: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState("");
  const set = (k: keyof Row, v: any) => onChange({ ...row, [k]: v });
  const subs = categories.find((c) => c.name === row.category)?.subs || [];

  async function upload(file?: File) {
    if (!file) return;
    setUploading(true); setUpErr("");
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setUploading(false);
    if (!r.ok) { setUpErr(j.error || "Upload failed"); return; }
    set("mainImage", j.url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold">{isNew ? "Add product" : row.title}</h2>
            {!isNew && <p className="font-mono text-xs text-ink/45">{row.productCode}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-ink/40 hover:text-ink"><X size={18} /></button>
        </div>

        {error && <Notice tone="danger" className="mt-3">{error}</Notice>}

        <div className="mt-5 grid gap-4">
          <label className="text-xs font-semibold text-ink/60">Title *
            <input value={row.title} onChange={(e) => set("title", e.target.value)} className={`mt-1 ${input}`} placeholder="e.g. 9kg 1400 Spin Washing Machine — White" />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink/60">Brand
              <input value={row.brand} onChange={(e) => set("brand", e.target.value)} className={`mt-1 ${input}`} placeholder="Bosch" />
            </label>
            <label className="text-xs font-semibold text-ink/60">Product code *
              <input value={row.productCode} onChange={(e) => set("productCode", e.target.value)} className={`mt-1 ${input} font-mono`} placeholder="WGG254Z1GB" />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink/60">Category
              <select value={row.category} onChange={(e) => onChange({ ...row, category: e.target.value, subcategory: "" })} className={`mt-1 ${input}`}>
                <option value="">— none —</option>
                {categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-ink/60">Sub-category
              <select value={row.subcategory} onChange={(e) => set("subcategory", e.target.value)} className={`mt-1 ${input}`} disabled={!subs.length}>
                <option value="">— none —</option>
                {subs.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-xs font-semibold text-ink/60">Price (£)
              <input type="number" step="0.01" min="0" value={row.priceNow ?? ""}
                onChange={(e) => set("priceNow", e.target.value === "" ? null : Number(e.target.value))}
                className={`mt-1 ${input}`} placeholder="Leave blank = “Call for price”" />
            </label>
            <label className="text-xs font-semibold text-ink/60">Was (£)
              <input type="number" step="0.01" min="0" value={row.priceWas ?? ""}
                onChange={(e) => set("priceWas", e.target.value === "" ? null : Number(e.target.value))}
                className={`mt-1 ${input}`} />
            </label>
            <label className="text-xs font-semibold text-ink/60">Stock
              <select value={row.availabilityNormalised} onChange={(e) => set("availabilityNormalised", e.target.value)} className={`mt-1 ${input}`}>
                {AVAIL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>

          <label className="text-xs font-semibold text-ink/60">Warranty
            <input value={row.warranty} onChange={(e) => set("warranty", e.target.value)} className={`mt-1 ${input}`} placeholder="5 year guarantee" />
          </label>

          <label className="text-xs font-semibold text-ink/60">Description
            <textarea rows={3} value={row.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} className={`mt-1 ${input} resize-y`} />
          </label>

          <label className="text-xs font-semibold text-ink/60">Delivery note
            <input value={row.deliveryNotes} onChange={(e) => set("deliveryNotes", e.target.value)} className={`mt-1 ${input}`}
              placeholder="e.g. Own van, next day locally — two-man delivery" />
            <span className="mt-1 block font-normal text-[11px] text-muted">Shown on this product&apos;s page. Leave blank to use the standard delivery wording.</span>
          </label>

          <div>
            <span className="text-xs font-semibold text-ink/60">Photo</span>
            <div className="mt-1 flex items-center gap-4">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white">
                {row.mainImage
                  /* eslint-disable-next-line @next/next/no-img-element */
                  ? <img src={row.mainImage} alt="" className="h-full w-full object-contain p-1" />
                  : <span className="text-[10px] text-ink/30">No photo</span>}
              </div>
              <div className="flex-1">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-navy/20 px-4 py-2 text-xs font-semibold hover:border-blue">
                  <Upload size={14} /> {uploading ? "Uploading…" : "Upload photo"}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" className="hidden"
                    onChange={(e) => upload(e.target.files?.[0])} />
                </label>
                <input value={row.mainImage} onChange={(e) => set("mainImage", e.target.value)}
                  className={`mt-2 ${input} text-xs`} placeholder="…or paste an image URL" />
                {upErr && <p className="mt-1 text-xs text-danger">{upErr}</p>}
                <p className="mt-1 text-[11px] text-muted">JPG, PNG, WebP, AVIF or GIF · max 8MB</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-5 border-t border-line pt-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={row.isVisible} onChange={(e) => set("isVisible", e.target.checked)} />
              Show on website
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={row.featured} onChange={(e) => set("featured", e.target.checked)} />
              Featured
            </label>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted">
          Edited fields are locked so a future catalogue re-import won&apos;t overwrite your changes.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? "Saving…" : isNew ? "Add product" : "Save changes"}</Button>
        </div>
      </div>
    </div>
  );
}
