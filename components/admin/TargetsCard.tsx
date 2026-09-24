"use client";
import { useState } from "react";
import { Card } from "@/components/admin/ui";

/**
 * Dashboard: the month so far against the targets the owner sets. Targets
 * live in the marketing settings (BusinessInfo.marketing.targets); 0 = none.
 */
type Targets = { adCalls: number; enquiries: number; sales: number; adSpend: number };
type Month = { label: string; pace: number; adCalls: number; enquiries: number; sales: number; adSpend: number };

const ROWS: [keyof Targets, string, boolean][] = [
  ["adCalls", "Calls & enquiries from ads", false],
  ["enquiries", "Website enquiries", false],
  ["sales", "Sales won (this month's leads)", false],
  ["adSpend", "Ad spend (cap)", true],
];

export default function TargetsCard({ month, targets }: { month: Month; targets: Targets }) {
  const [t, setT] = useState(targets);
  const [saved, setSaved] = useState(targets);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    const r = await fetch("/api/admin/marketing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", value: { targets: t } }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (r?.ok) { setT(j.targets); setSaved(j.targets); setEditing(false); } else setErr(j.error || "Could not save.");
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">{month.label} · targets</h2>
        <button onClick={() => { if (editing) setT(saved); setErr(""); setEditing((e) => !e); }} className="text-xs font-semibold text-blue hover:underline">{editing ? "Cancel" : "Edit targets"}</button>
      </div>
      <ul className="space-y-2.5">
        {ROWS.map(([key, label, isCap]) => {
          const actual = month[key], target = t[key];
          const pct = target ? Math.min(100, Math.round((actual / target) * 100)) : 0;
          const fmt = (n: number) => (key === "adSpend" ? `£${n.toFixed(0)}` : String(Math.round(n)));
          const over = isCap && target > 0 && actual > target;
          return (
            <li key={key}>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-ink/80">{label}</span>
                {editing
                  ? <input type="number" min={0} value={target} onChange={(e) => setT({ ...t, [key]: Number(e.target.value) })} className="w-24 rounded-lg border border-line px-2 py-1 text-right text-sm" aria-label={`${label} target`} />
                  : <span className="tabular-nums"><strong>{fmt(actual)}</strong>{target ? <span className="text-muted"> / {fmt(target)}</span> : <span className="text-muted"> · no target</span>}</span>}
              </div>
              {!editing && target > 0 && (
                <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-paper-2">
                  <div className={`h-full rounded-full ${over ? "bg-danger" : pct >= 100 ? (isCap ? "bg-warning" : "bg-success") : "bg-blue"}`} style={{ width: `${pct}%` }} />
                  {/* where the month is: level with this line = on pace */}
                  <span className="absolute top-0 h-full w-0.5 bg-ink/40" style={{ left: `${month.pace}%` }} title={`${month.pace}% of the month gone`} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {editing && (
        <div className="mt-3 flex items-center gap-3">
          <button onClick={save} disabled={busy} className="rounded-full bg-navy px-4 py-1.5 text-xs font-bold text-paper disabled:opacity-50">{busy ? "Saving…" : "Save targets"}</button>
          {err && <span className="text-xs text-danger">{err}</span>}
        </div>
      )}
      {!editing && !Object.values(t).some(Boolean) && <p className="mt-3 text-[12px] text-muted">Set a monthly target for each line and the bars show how the month is going.</p>}
      {!editing && Object.values(t).some(Boolean) && <p className="mt-3 text-[11.5px] text-muted">The thin mark is how far through the month we are ({month.pace}%): a bar past it is ahead.</p>}
    </Card>
  );
}
