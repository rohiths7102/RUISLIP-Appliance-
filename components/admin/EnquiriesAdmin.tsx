"use client";
import { useEffect, useState } from "react";
import { Badge, Card, EmptyState, Notice, PageTitle, type Tone } from "@/components/admin/ui";
type E = { id: string; createdAt: string; source: string; productCode: string; productTitle: string; name: string; email: string; phone: string; message: string; status: string };
const STATUS_TONE: Record<string, Tone> = { new: "info", contacted: "warning", closed: "success" };
export default function EnquiriesAdmin() {
  const [rows, setRows] = useState<E[]>([]); const [loaded, setLoaded] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { (async () => { try { const r = await fetch("/api/admin/enquiries"); if (r.ok) setRows(await r.json()); else setErr("Could not load enquiries."); } catch { setErr("Could not load enquiries."); } setLoaded(true); })(); }, []);
  async function setStatus(id: string, status: string) {
    const r = await fetch("/api/admin/enquiries", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    if (r.ok) setRows((rs) => rs.map((x) => (x.id === id ? { ...x, status } : x)));
  }
  return (
    <div>
      <PageTitle
        count={rows.length}
        actions={
          <a href="/api/admin/enquiries/export" className="rounded-full px-5 py-2.5 text-sm font-medium transition-colors border border-navy/20 text-ink hover:border-blue hover:text-blue-deep">
            Export CSV
          </a>
        }
      >
        Enquiries
      </PageTitle>
      {err && <Notice tone="warning" className="mt-4">{err} Enquiries appear here once the database is running and a customer submits the enquiry form.</Notice>}
      {loaded && !rows.length && !err && <div className="mt-4"><EmptyState title="No enquiries yet." /></div>}
      {rows.length > 0 && (
        <Card className="mt-4 overflow-x-auto">
          <table className="w-full text-sm"><thead className="bg-paper-2 text-left text-muted"><tr><th className="p-3">Date</th><th className="p-3">Code</th><th className="p-3">Customer</th><th className="p-3">Message</th><th className="p-3">Status</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id} className="border-t border-line align-top">
                <td className="p-3 whitespace-nowrap text-xs">{new Date(e.createdAt).toLocaleDateString()}</td>
                <td className="p-3 font-mono text-xs">{e.productCode || "—"}</td>
                <td className="p-3">{e.name}<div className="text-xs text-muted">{e.email} {e.phone}</div></td>
                <td className="p-3 max-w-xs text-xs text-ink/70">{e.message}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[e.status] ?? "neutral"}>{e.status}</Badge>
                    <select value={e.status} onChange={(ev) => setStatus(e.id, ev.target.value)} className="rounded border border-line px-2 py-1 text-xs"><option value="new">new</option><option value="contacted">contacted</option><option value="closed">closed</option></select>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
