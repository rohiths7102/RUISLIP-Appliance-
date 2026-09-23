"use client";
import { useState } from "react";
import { Badge, Card } from "@/components/admin/ui";

/**
 * Admin → Google Ads report explorer. Rows come from AdsSnapshot (lib/ads-reports.ts),
 * fed nightly by the Ads Script or live by the API. With the API connected,
 * a wasted search can be blocked and a keyword paused from here; every such
 * change is audited server-side (app/api/admin/ads/route.ts).
 */
type Row = { label: string; detail?: string; key?: string; status?: string; quality?: number | null; clicks: number; impressions: number; cost: number; conversions: number };
type Tab = "searchTerms" | "keywords" | "ads" | "postcodes" | "when" | "devices" | "conversionActions";

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const per = (r: Row) => (r.conversions ? gbp(r.cost / r.conversions) : "—");
const TABS: [Tab, string][] = [
  ["searchTerms", "What people searched"], ["keywords", "Keywords"], ["ads", "Ads"], ["postcodes", "Where"],
  ["when", "When"], ["devices", "Devices"], ["conversionActions", "Calls & actions"],
];

export default function AdsReports({ reports, zone, live }: {
  reports: Record<string, Row[]>; zone: Record<string, boolean>; live: boolean;
}) {
  const [tab, setTab] = useState<Tab>("searchTerms");
  const [done, setDone] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");

  async function act(action: string, value: string, confirmText: string) {
    if (!confirm(confirmText)) return;
    setErr("");
    const r = await fetch("/api/admin/ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, value }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) { setErr(j.error || "Google Ads didn't accept that."); return; }
    setDone((d) => ({ ...d, [`${action}:${value}`]: action === "block_search" ? "Blocked" : "Paused" }));
  }

  const rows = (name: string) => reports[name] || [];
  const table = (list: Row[], opts: { first: string; extra?: (r: Row) => React.ReactNode; action?: (r: Row) => React.ReactNode; money?: boolean } ) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-2">{opts.first}</th>
            {opts.money !== false && <><th className="py-2 text-right">Clicks</th><th className="py-2 text-right">Spent</th></>}
            <th className="py-2 text-right">{opts.money === false ? "Count" : "Conversions"}</th>
            {opts.money !== false && <th className="py-2 text-right">Per conversion</th>}
            {opts.action && <th />}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {list.map((r, i) => {
            const wasted = opts.money !== false && r.cost >= 3 && !r.conversions;
            return (
              <tr key={`${r.label}-${r.key ?? i}`} className={wasted ? "bg-warning-soft/40" : ""}>
                <td className="py-2 pr-3">
                  <span className="font-medium">{r.label}</span>
                  {r.detail && <span className="block text-xs text-muted">{r.detail}</span>}
                  {opts.extra?.(r)}
                </td>
                {opts.money !== false && <>
                  <td className="py-2 text-right tabular-nums">{r.clicks}</td>
                  <td className="py-2 text-right tabular-nums">{gbp(r.cost)}</td>
                </>}
                <td className="py-2 text-right tabular-nums">{Math.round(r.conversions * 10) / 10}</td>
                {opts.money !== false && <td className="py-2 text-right tabular-nums">{per(r)}</td>}
                {opts.action && <td className="py-2 pl-3 text-right">{opts.action(r)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!list.length && <p className="py-6 text-center text-sm text-muted">Nothing yet — this fills in after the first sync.</p>}
    </div>
  );

  const actionBtn = (action: string, value: string, label: string, confirmText: string) =>
    done[`${action}:${value}`]
      ? <Badge tone="success">{done[`${action}:${value}`]}</Badge>
      : live && <button onClick={() => act(action, value, confirmText)} className="rounded-full border border-navy/20 px-3 py-1 text-xs font-medium hover:border-danger hover:text-danger">{label}</button>;

  const bars = (list: Row[], label: (r: Row) => string) => {
    const max = Math.max(1, ...list.map((r) => r.clicks));
    return (
      <ul className="space-y-1.5 text-sm">
        {list.map((r) => (
          <li key={r.label} className="grid grid-cols-[90px_1fr_150px] items-center gap-3">
            <span className="text-ink/80">{label(r)}</span>
            <span className="h-3 overflow-hidden rounded-full bg-paper-2"><span className="block h-full rounded-full bg-blue" style={{ width: `${(r.clicks / max) * 100}%` }} /></span>
            <span className="text-right text-xs tabular-nums text-muted">{r.clicks} clicks · {Math.round(r.conversions)} conv.</span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <Card className="mt-6 p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Inside the account · last 30 days</h2>
      <div className="mt-3 flex flex-wrap gap-1.5" role="tablist">
        {TABS.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${tab === t ? "bg-navy text-paper" : "border border-navy/20 hover:border-blue"}`}>{label}</button>
        ))}
      </div>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}

      <div className="mt-4">
        {tab === "searchTerms" && <>
          <p className="mb-2 text-xs text-muted">Highlighted: £3 or more spent with no call or enquiry.{live ? " “Block” stops the ads showing for that exact search." : ""}</p>
          {table(rows("searchTerms"), { first: "Search", action: (r) => actionBtn("block_search", r.label, "Block", `Stop showing ads for exactly “${r.label}”?`) })}
        </>}
        {tab === "keywords" && table(rows("keywords"), {
          first: "Keyword",
          extra: (r) => <span className="mt-0.5 flex gap-1.5">
            {r.status === "PAUSED" && <Badge tone="neutral">paused</Badge>}
            {r.quality != null && <Badge tone={r.quality >= 7 ? "success" : r.quality >= 5 ? "warning" : "danger"}>quality {r.quality}/10</Badge>}
          </span>,
          action: (r) => r.status !== "PAUSED" && r.key ? actionBtn("pause_keyword", r.key, "Pause", `Pause the keyword “${r.label}”? (You can switch it back on in Google Ads.)`) : null,
        })}
        {tab === "ads" && table(rows("ads"), {
          first: "Ad",
          extra: (r) => r.key && r.key !== "UNSPECIFIED" && <span className="mt-0.5 inline-block"><Badge tone={r.key === "EXCELLENT" || r.key === "GOOD" ? "success" : r.key === "AVERAGE" ? "warning" : "danger"}>strength {r.key.toLowerCase()}</Badge></span>,
        })}
        {tab === "postcodes" && table(rows("postcodes"), {
          first: "Postcode district (where the searcher was)",
          extra: (r) => <span className="mt-0.5 inline-block">{zone[r.label] ? <Badge tone="success">delivery zone</Badge> : <Badge tone="danger">outside zone</Badge>}</span>,
        })}
        {tab === "when" && <div className="grid gap-6 lg:grid-cols-2">
          <div><h3 className="mb-2 text-xs font-bold uppercase text-muted">Day of the week</h3>{bars(rows("weekdays"), (r) => r.label.slice(0, 1) + r.label.slice(1, 3).toLowerCase())}</div>
          <div><h3 className="mb-2 text-xs font-bold uppercase text-muted">Hour of the day</h3>{bars(rows("hours"), (r) => `${String(r.label).padStart(2, "0")}:00`)}</div>
        </div>}
        {tab === "devices" && table(rows("devices"), { first: "Device" })}
        {tab === "conversionActions" && <>
          <p className="mb-2 text-xs text-muted">Every action Google recorded from the ads, including ones it doesn&apos;t bid on (like directions to the shop).</p>
          {table(rows("conversionActions"), { first: "Action", money: false })}
        </>}
      </div>
    </Card>
  );
}

/** "Sync now" — only offered once the direct API connection is live. */
export function SyncNowButton() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      <button disabled={state === "busy"} className="rounded-full bg-navy px-4 py-2 text-xs font-medium text-paper disabled:opacity-50"
        onClick={async () => {
          setState("busy");
          const r = await fetch("/api/admin/ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) }).catch(() => null);
          const j = r ? await r.json().catch(() => ({})) : {};
          if (r?.ok) { setState("done"); location.reload(); } else { setState("error"); setMsg(j.error || "Sync failed"); }
        }}>
        {state === "busy" ? "Syncing…" : "Sync now"}
      </button>
      {state === "error" && <span className="text-xs text-danger">{msg}</span>}
    </span>
  );
}
