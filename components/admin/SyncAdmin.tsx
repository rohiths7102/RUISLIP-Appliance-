"use client";
import { useEffect, useState } from "react";
export default function SyncAdmin() {
  const [diff, setDiff] = useState<any>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [result, setResult] = useState<any>(null);
  async function loadPreview() { setErr(""); try { const r = await fetch("/api/admin/sync/preview"); if (r.ok) setDiff(await r.json()); else setErr("Preview needs the database running."); } catch { setErr("Preview needs the database running."); } }
  useEffect(() => { loadPreview(); }, []);
  async function apply() {
    setBusy(true); setResult(null);
    const r = await fetch("/api/admin/sync/apply", { method: "POST" });
    setBusy(false);
    if (r.ok) { setResult(await r.json()); loadPreview(); } else setErr("Apply failed — is the database running?");
  }
  const N = (a: any[]) => (a ? a.length : 0);
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-semibold">Sync</h1>
      <p className="mt-2 text-sm text-ink/60">The live crawl runs on the server (<code>npm run scrape</code>, respecting the site&apos;s 20s crawl-delay) and writes <code>data/*.json</code>. Here you review what would change and import it into the database. Admin-edited (locked) fields are never overwritten.</p>
      {err && <p className="mt-4 rounded bg-paper-2 px-3 py-2 text-sm text-ink/60">{err}</p>}
      {result && <div className="mt-4 rounded-xl bg-blue/15 px-4 py-3 text-sm">Imported ✓ — created {result.created}, updated {result.updated}, failed {result.failed}, not-in-scrape {result.removed}.</div>}
      {diff && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[["New products", N(diff.newProducts)], ["Price changes", N(diff.priceChanges)], ["Availability changes", N(diff.availabilityChanges)], ["Removed", N(diff.removed)]].map(([l, n]) => (
              <div key={l as string} className="rounded-2xl border border-line bg-white p-4"><div className="font-display text-2xl">{n as number}</div><div className="text-xs text-ink/60">{l}</div></div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink/40">{diff.locked} product(s) have admin-locked fields that will be preserved.</p>
          {N(diff.priceChanges) > 0 && (
            <div className="mt-4 rounded-2xl border border-line bg-white p-4">
              <div className="text-sm font-medium">Price changes</div>
              <ul className="mt-2 space-y-1 text-sm">{diff.priceChanges.slice(0, 20).map((c: any) => <li key={c.code} className="flex justify-between"><span className="font-mono text-xs">{c.code}</span><span>£{c.from ?? "—"} → <strong>£{c.to ?? "—"}</strong></span></li>)}</ul>
            </div>
          )}
          <button onClick={apply} disabled={busy} className="mt-6 rounded-full bg-navy px-6 py-3 font-medium text-paper disabled:opacity-50">{busy ? "Importing…" : "Apply import to database"}</button>
        </>
      )}
    </div>
  );
}
