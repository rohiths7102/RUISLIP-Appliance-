"use client";
import { useState } from "react";
type Row = { id: string; name: string; slug: string; logo: string; description: string; productCount: number; isVisible: boolean };
export default function BrandsAdmin({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial); const [sel, setSel] = useState<Row | null>(null); const [msg, setMsg] = useState(""); const [saving, setSaving] = useState(false);
  const upd = (k: keyof Row, v: any) => setSel((s) => (s ? { ...s, [k]: v } : s));
  async function save() {
    if (!sel) return; setSaving(true); setMsg("");
    const r = await fetch(`/api/admin/brands/${sel.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logo: sel.logo, description: sel.description, isVisible: sel.isVisible }) });
    setSaving(false);
    if (r.ok) { const u = await r.json(); setRows((rs) => rs.map((x) => (x.id === u.id ? { ...x, ...u } : x))); setSel(null); setMsg("Saved ✓"); } else setMsg("Save failed — is the database running?");
  }
  return (
    <div>
      <div className="flex items-center justify-between"><h1 className="font-display text-2xl font-semibold">Brands <span className="text-sm text-ink/40">({rows.length})</span></h1>{msg && <span className="text-sm text-blue">{msg}</span>}</div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((r) => (
          <div key={r.id} className="rounded-2xl border border-line bg-white p-4 text-center">
            <div className="flex h-16 items-center justify-center">{r.logo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={r.logo} alt={r.name} className="max-h-12 max-w-[80%] object-contain" /> : <span className="text-ink/40">{r.name}</span>}</div>
            <div className="mt-2 text-sm font-medium">{r.name}</div><div className="text-xs text-ink/50">{r.productCount} products · {r.isVisible ? "visible" : "hidden"}</div>
            <button onClick={() => { setSel(r); setMsg(""); }} className="mt-2 rounded-full border border-navy/20 px-3 py-1 text-xs hover:border-blue">Edit</button>
          </div>
        ))}
      </div>
      {sel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSel(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg font-semibold">{sel.name}</h2>
            <div className="mt-4 grid gap-3 text-sm">
              <label>Logo URL<input value={sel.logo} onChange={(e) => upd("logo", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
              <label>Description<textarea rows={3} value={sel.description} onChange={(e) => upd("description", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={sel.isVisible} onChange={(e) => upd("isVisible", e.target.checked)} /> Visible</label>
            </div>
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setSel(null)} className="rounded-full border border-navy/20 px-4 py-2 text-sm">Cancel</button><button onClick={save} disabled={saving} className="rounded-full bg-navy px-4 py-2 text-sm font-medium text-paper disabled:opacity-50">{saving ? "Saving…" : "Save"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
