"use client";
import { useState } from "react";
import { Button, Card, PageTitle } from "@/components/admin/ui";
type Row = { id: string; name: string; slug: string; image: string; description: string; seoTitle: string; seoDescription: string; productCount: number; isVisible: boolean; order: number; parentId: string | null };
export default function CategoriesAdmin({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial); const [sel, setSel] = useState<Row | null>(null); const [msg, setMsg] = useState(""); const [saving, setSaving] = useState(false);
  const upd = (k: keyof Row, v: any) => setSel((s) => (s ? { ...s, [k]: v } : s));
  async function save() {
    if (!sel) return; setSaving(true); setMsg("");
    const r = await fetch(`/api/admin/categories/${sel.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: sel.name, image: sel.image, description: sel.description, seoTitle: sel.seoTitle, seoDescription: sel.seoDescription, isVisible: sel.isVisible, order: Number(sel.order) }) });
    setSaving(false);
    if (r.ok) { const u = await r.json(); setRows((rs) => rs.map((x) => (x.id === u.id ? { ...x, ...u } : x))); setSel(null); setMsg("Saved ✓"); } else setMsg("Save failed — is the database running?");
  }
  return (
    <div>
      <PageTitle count={rows.length} actions={msg ? <span className="text-sm text-blue">{msg}</span> : undefined}>Categories</PageTitle>
      <Card className="mt-4 overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-paper-2 text-left text-muted"><tr><th className="p-3">Name</th><th className="p-3">Products</th><th className="p-3">Visible</th><th className="p-3">Order</th><th className="p-3"></th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="border-t border-line"><td className="p-3">{r.name}{r.parentId ? <span className="ml-1 text-xs text-ink/40">(sub)</span> : null}</td><td className="p-3">{r.productCount}</td><td className="p-3">{r.isVisible ? "Yes" : "No"}</td><td className="p-3">{r.order}</td>
            <td className="p-3"><Button variant="secondary" small onClick={() => { setSel(r); setMsg(""); }}>Edit</Button></td></tr>
        ))}</tbody>
      </table></Card>
      {sel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSel(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg font-semibold">{sel.name}</h2>
            <div className="mt-4 grid gap-3 text-sm">
              <label>Name<input value={sel.name} onChange={(e) => upd("name", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
              <label>Image URL<input value={sel.image} onChange={(e) => upd("image", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
              <label>SEO title<input value={sel.seoTitle} onChange={(e) => upd("seoTitle", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
              <label>SEO description<textarea rows={2} value={sel.seoDescription} onChange={(e) => upd("seoDescription", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
              <div className="flex items-center gap-4"><label className="flex items-center gap-2"><input type="checkbox" checked={sel.isVisible} onChange={(e) => upd("isVisible", e.target.checked)} /> Visible</label><label className="flex items-center gap-2">Order <input type="number" value={sel.order} onChange={(e) => upd("order", Number(e.target.value))} className="w-20 rounded border border-line px-2 py-1" /></label></div>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setSel(null)}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
