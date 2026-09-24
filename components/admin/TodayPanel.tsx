"use client";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge, Button, Card, Notice } from "@/components/admin/ui";
import type { Action } from "@/lib/marketing/engine";
import type { MarketingSettings } from "@/lib/marketing/settings";

/**
 * Admin → Today, the interactive half: the action list (each with its one
 * click, or "ignore for 30 days") and the engine's switches. Changes to Google
 * Ads go through /api/admin/ads, settings and dismissals through
 * /api/admin/marketing — both audited server-side.
 */
const TONE: Record<Action["area"], "danger" | "warning" | "info" | "success" | "neutral"> = {
  "Google Ads": "info", Leads: "danger", Prices: "warning", "Shopping feed": "neutral", SEO: "neutral", Chatbot: "neutral",
};

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  return { ok: !!r?.ok, j };
}

export function ActionList({ initial, live }: { initial: Action[]; live: boolean }) {
  const [list, setList] = useState(initial);
  const [done, setDone] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");

  async function apply(a: Action) {
    if (a.cta.kind !== "api" || !confirm(a.cta.confirm)) return;
    setErr("");
    const { ok, j } = await post("/api/admin/ads", { action: a.cta.action, value: a.cta.value });
    if (!ok) { setErr(j.error || "Google Ads didn't accept that."); return; }
    setDone((d) => ({ ...d, [a.key]: a.cta.kind === "api" && a.cta.action === "block_search" ? "Blocked" : "Paused" }));
  }
  async function dismiss(a: Action) {
    const { ok } = await post("/api/admin/marketing", { action: "dismiss", key: a.key });
    if (ok) setList((l) => l.filter((x) => x.key !== a.key));
    else setErr("Couldn't hide that — try again.");
  }

  if (!list.length) return <Card className="p-8 text-center text-sm text-muted">Nothing to do — everything the engine checks is in order.</Card>;
  return (
    <div>
      {err && <Notice tone="danger" className="mb-3">{err}</Notice>}
      <ol className="space-y-2.5">
        {list.map((a, i) => (
          <li key={a.key}>
            <Card className={`flex flex-wrap items-start gap-4 p-4 ${done[a.key] ? "opacity-60" : ""}`}>
              <span className="w-6 pt-0.5 text-right font-mono text-xs text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONE[a.area]}>{a.area}</Badge>
                  <span className="font-semibold">{a.title}</span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{a.why}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {done[a.key] ? <Badge tone="success">{done[a.key]}</Badge>
                  : a.cta.kind === "api"
                    ? live ? <Button small onClick={() => apply(a)}>{a.cta.label}</Button> : <span className="text-xs text-muted">Connect Google to do this here</span>
                    : <a href={a.cta.href} target={a.cta.external ? "_blank" : undefined} rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-navy/20 px-4 py-2 text-xs font-medium hover:border-blue">
                        {a.cta.label}{a.cta.external && <ExternalLink size={11} />}
                      </a>}
                {!done[a.key] && <button onClick={() => dismiss(a)} className="text-xs text-muted hover:text-ink">Hide 30 days</button>}
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function EngineSettings({ initial, tonight, cronReady }: { initial: MarketingSettings; tonight: { label: string; cost: number; clicks: number }[]; cronReady: boolean }) {
  const [s, setS] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<MarketingSettings>) => { setS((x) => ({ ...x, ...p })); setMsg(null); };

  async function save() {
    setBusy(true);
    const { ok, j } = await post("/api/admin/marketing", { action: "settings", value: s });
    setBusy(false);
    if (!ok) { setMsg({ tone: "danger", text: j.error || "Could not save." }); return; }
    setS(j); setSaved(j);
    // The server drops an address it can't use; say so rather than "Saved."
    setMsg(s.reportTo.trim() && !j.reportTo ? { tone: "danger", text: "That email address doesn't look right." } : { tone: "success", text: "Saved." });
  }
  async function sendNow() {
    setBusy(true);
    const { ok, j } = await post("/api/admin/marketing", { action: "send_report" });
    setBusy(false);
    setMsg(ok ? { tone: "success", text: `Report sent via ${j.via}.` } : { tone: "danger", text: j.error || "Could not send." });
  }

  const field = "rounded-lg border border-line px-3 py-2 text-sm";
  return (
    <Card className="p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Automation</h2>
      {!cronReady && <Notice tone="warning" className="mt-3">The daily run isn&apos;t switched on yet (it needs the <code className="font-mono">CRON_SECRET</code> setting in Vercel). Until then nothing runs by itself.</Notice>}

      <label className="mt-4 flex items-start gap-3">
        <input type="checkbox" checked={s.autoBlock} onChange={(e) => set({ autoBlock: e.target.checked })} className="mt-1" />
        <span>
          <span className="font-semibold">Block wasted searches every night</span>
          <span className="block text-[13px] text-muted">
            A search is blocked only if in 30 days it cost at least £{s.autoBlockMinSpend}, had 3+ clicks, brought no call or enquiry,
            and doesn&apos;t contain your shop&apos;s name. At most {s.autoBlockMaxPerDay} a night. Every block is in the audit log.
          </span>
        </span>
      </label>
      <div className="ml-7 mt-3 flex flex-wrap gap-4 text-[13px]">
        <label>Minimum spend £ <input type="number" min={3} max={100} value={s.autoBlockMinSpend} onChange={(e) => set({ autoBlockMinSpend: Number(e.target.value) })} className={`${field} w-20`} aria-label="Minimum spend in pounds" /></label>
        <label>Most per night <input type="number" min={1} max={25} value={s.autoBlockMaxPerDay} onChange={(e) => set({ autoBlockMaxPerDay: Number(e.target.value) })} className={`${field} w-20`} aria-label="Most searches blocked per night" /></label>
      </div>
      {(() => {
        const would = tonight.filter((t) => t.cost >= s.autoBlockMinSpend).slice(0, Math.max(1, s.autoBlockMaxPerDay));
        return (
          <div className="ml-7 mt-3 rounded-lg bg-paper-2/70 p-3 text-[13px]">
            <p className="font-semibold">{s.autoBlock ? "With these settings, tonight it will block" : "If switched on, tonight it would block"} {would.length ? `${would.length}:` : "nothing."}</p>
            {would.length > 0 && <ul className="mt-1 space-y-0.5">{would.map((t) => <li key={t.label}>“{t.label}” — £{t.cost.toFixed(2)}, {t.clicks} clicks, no calls</li>)}</ul>}
          </div>
        );
      })()}

      <label className="mt-5 flex items-start gap-3">
        <input type="checkbox" checked={s.weeklyReport} onChange={(e) => set({ weeklyReport: e.target.checked })} className="mt-1" />
        <span>
          <span className="font-semibold">Email the weekly report every Monday</span>
          <span className="block text-[13px] text-muted">This week against last, what changed in Google Ads, and the top five things to do.</span>
        </span>
      </label>
      <div className="ml-7 mt-3 flex flex-wrap items-center gap-2">
        <input type="email" value={s.reportTo} onChange={(e) => set({ reportTo: e.target.value })} placeholder="email address" aria-label="Email address for the weekly report" className={`${field} w-full sm:w-72`} />
        <Button small variant="secondary" onClick={sendNow} disabled={busy || !saved.reportTo || s.reportTo !== saved.reportTo}
          title={s.reportTo !== saved.reportTo ? "Save the address first" : undefined}>Send one now</Button>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button small onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        {msg && <span className={`text-sm ${msg.tone === "success" ? "text-success" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </Card>
  );
}
