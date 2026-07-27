"use client";
import { useEffect, useState } from "react";
import { Button, Card, Notice, PageTitle, StatTile } from "@/components/admin/ui";
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
      <PageTitle>Sync</PageTitle>
      <p className="mt-2 text-sm text-muted">The live crawl runs on the server (<code>npm run scrape</code>, respecting the site&apos;s 20s crawl-delay) and writes <code>data/*.json</code>. Here you review what would change and import it into the database. Admin-edited (locked) fields are never overwritten.</p>
      {err && <Notice tone="warning" className="mt-4">{err}</Notice>}
      {result && <Notice tone="success" className="mt-4">Imported ✓ — created {result.created}, updated {result.updated}, failed {result.failed}, not-in-scrape {result.removed}.</Notice>}
      {diff && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[["New products", N(diff.newProducts)], ["Price changes", N(diff.priceChanges)], ["Availability changes", N(diff.availabilityChanges)], ["Removed", N(diff.removed)]].map(([l, n]) => (
              <StatTile key={l as string} label={l as string} value={n as number} />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">{diff.locked} product(s) have admin-locked fields that will be preserved.</p>
          {N(diff.priceChanges) > 0 && (
            <Card className="mt-4 p-4">
              <div className="text-sm font-medium">Price changes</div>
              <ul className="mt-2 space-y-1 text-sm">{diff.priceChanges.slice(0, 20).map((c: any) => <li key={c.code} className="flex justify-between"><span className="font-mono text-xs">{c.code}</span><span>£{c.from ?? "—"} → <strong>£{c.to ?? "—"}</strong></span></li>)}</ul>
            </Card>
          )}
          <Button onClick={apply} disabled={busy} className="mt-6">{busy ? "Importing…" : "Apply import to database"}</Button>
        </>
      )}
    </div>
  );
}
