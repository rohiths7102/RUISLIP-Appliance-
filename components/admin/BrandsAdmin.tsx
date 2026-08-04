"use client";
import { useState } from "react";
import { Card, Button, PageTitle } from "@/components/admin/ui";
type Row = { id: string; name: string; slug: string; logo: string; description: string; productCount: number; isVisible: boolean; order?: number };
export default function BrandsAdmin({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial); const [sel, setSel] = useState<Row | null>(null); const [msg, setMsg] = useState(""); const [saving, setSaving] = useState(false);
  const upd = (k: keyof Row, v: any) => setSel((s) => (s ? { ...s, [k]: v } : s));
  async function save() {
    if (!sel) return; setSaving(true); setMsg("");
    const r = await fetch(`/api/admin/brands/${sel.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logo: sel.logo, description: sel.description, isVisible: sel.isVisible, order: Number(sel.order ?? 100) }) });
    setSaving(false);
    if (r.ok) { const u = await r.json(); setRows((rs) => rs.map((x) => (x.id === u.id ? { ...x, ...u } : x))); setSel(null); setMsg("Saved ✓"); } else setMsg("Save failed — is the database running?");
  }
  return (
    <div>
      <PageTitle count={rows.length} actions={msg && <span className="text-sm text-blue">{msg}</span>}>Brands</PageTitle>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((r) => (
          <Card key={r.id} className="p-4 text-center">
            <div className="flex h-16 items-center justify-center">{r.logo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={r.logo} alt={r.name} className="max-h-12 max-w-[80%] object-contain" /> : <span className="text-ink/40">{r.name}</span>}</div>
            <div className="mt-2 text-sm font-medium">{r.name}</div><div className="text-xs text-muted">{r.productCount} products · {r.isVisible ? "visible" : "hidden"}</div>
            <Button variant="secondary" small className="mt-2" onClick={() => { setSel(r); setMsg(""); }}>Edit</Button>
          </Card>
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
              <label className="flex items-center gap-2">Front-page rank <input type="number" value={sel.order ?? 100} onChange={(e) => upd("order", Number(e.target.value))} className="w-20 rounded border border-line px-2 py-1" /> <span className="text-xs text-muted">(low = first on /brands; 100 = alphabetical)</span></label>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setSel(null)}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
