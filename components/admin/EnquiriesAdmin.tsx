"use client";
import { useEffect, useState } from "react";
type E = { id: string; createdAt: string; source: string; productCode: string; productTitle: string; name: string; email: string; phone: string; message: string; status: string };
export default function EnquiriesAdmin() {
  const [rows, setRows] = useState<E[]>([]); const [loaded, setLoaded] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { (async () => { try { const r = await fetch("/api/admin/enquiries"); if (r.ok) setRows(await r.json()); else setErr("Could not load enquiries."); } catch { setErr("Could not load enquiries."); } setLoaded(true); })(); }, []);
  async function setStatus(id: string, status: string) {
    const r = await fetch("/api/admin/enquiries", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    if (r.ok) setRows((rs) => rs.map((x) => (x.id === id ? { ...x, status } : x)));
  }
  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Enquiries <span className="text-sm text-ink/40">({rows.length})</span></h1>
        <a href="/api/admin/enquiries/export" className="rounded-full border border-navy/20 px-4 py-2 text-sm hover:border-blue">Export CSV</a>
      </div>
      {err && <p className="mt-4 text-sm text-ink/50">{err} Enquiries appear here once the database is running and a customer submits the enquiry form.</p>}
      {loaded && !rows.length && !err && <p className="mt-4 text-sm text-ink/50">No enquiries yet.</p>}
      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-sm"><thead className="bg-paper-2 text-left text-ink/60"><tr><th className="p-3">Date</th><th className="p-3">Code</th><th className="p-3">Customer</th><th className="p-3">Message</th><th className="p-3">Status</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id} className="border-t border-line align-top">
                <td className="p-3 whitespace-nowrap text-xs">{new Date(e.createdAt).toLocaleDateString()}</td>
                <td className="p-3 font-mono text-xs">{e.productCode || "—"}</td>
                <td className="p-3">{e.name}<div className="text-xs text-ink/50">{e.email} {e.phone}</div></td>
                <td className="p-3 max-w-xs text-xs text-ink/70">{e.message}</td>
                <td className="p-3"><select value={e.status} onChange={(ev) => setStatus(e.id, ev.target.value)} className="rounded border border-line px-2 py-1 text-xs"><option value="new">new</option><option value="contacted">contacted</option><option value="closed">closed</option></select></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
