"use client";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Notice, PageTitle, type Tone } from "@/components/admin/ui";
import {
  Sparkles, Send, Mail, Copy, Check, Loader2, Phone, ArrowUpRight, PoundSterling,
} from "lucide-react";

type Lead = {
  id: string; createdAt: string; source: string; productCode: string; productTitle: string;
  name: string; email: string; phone: string; message: string; status: string;
  notes: string; quotedPrice: number | null; lastEmailedAt: string | null;
  aiDraftSubject: string; aiDraftBody: string;
};

/** Pipeline stages ("closed" is legacy data — shown as won). */
const STAGES = ["new", "contacted", "quoted", "won", "lost"] as const;
const stageOf = (s: string) => (s === "closed" ? "won" : s);
const STAGE_TONE: Record<string, Tone> = { new: "info", contacted: "warning", quoted: "info", won: "success", lost: "neutral" };
const STAGE_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", quoted: "Quoted", won: "Won", lost: "Lost" };

/**
 * The sales side of the back office. Left: the pipeline. Right: one lead —
 * their words, the product with its real price, the owner's notes and quote,
 * and an AI-drafted reply he can edit and fire off. Send prefers the shop's
 * Microsoft 365 (one click, once Entra is connected); until then the same
 * button hands the draft to his own mail app instead of dying.
 */
export default function SalesAdmin() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [selId, setSelId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/enquiries");
        if (r.ok) { const j = await r.json(); setRows(j); if (j.length) setSelId(j[0].id); }
        else setErr("Could not load leads.");
      } catch { setErr("Could not load leads."); }
      setLoaded(true);
    })();
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const s of STAGES) c[s] = 0;
    for (const r of rows) c[stageOf(r.status)] = (c[stageOf(r.status)] || 0) + 1;
    return c;
  }, [rows]);

  const shown = filter === "all" ? rows : rows.filter((r) => stageOf(r.status) === filter);
  const sel = rows.find((r) => r.id === selId) || null;

  const patch = async (id: string, data: Record<string, unknown>) => {
    const r = await fetch("/api/admin/enquiries", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...data }),
    });
    if (r.ok) { const u = await r.json(); setRows((rs) => rs.map((x) => (x.id === id ? { ...x, ...u } : x))); return true; }
    return false;
  };

  return (
    <div>
      <PageTitle
        count={rows.length}
        actions={
          <a href="/api/admin/enquiries/export" className="rounded-full border border-navy/20 px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-blue hover:text-blue-deep">
            Export CSV
          </a>
        }
      >
        Sales &amp; Leads
      </PageTitle>

      {/* pipeline chips */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {(["all", ...STAGES] as string[]).map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${filter === s ? "bg-navy text-white" : "bg-paper-2 text-ink/70 hover:bg-line"}`}>
            {s === "all" ? "All" : STAGE_LABEL[s]} <span className="opacity-60">({counts[s] ?? 0})</span>
          </button>
        ))}
      </div>

      {err && <Notice tone="warning" className="mt-4">{err} Leads appear here when customers use the enquiry forms.</Notice>}
      {loaded && !rows.length && !err && (
        <div className="mt-4"><EmptyState title="No leads yet." hint="Every enquiry form on the site lands here — with AI reply drafting ready to go." /></div>
      )}

      {rows.length > 0 && (
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[340px_1fr]">
          {/* ---------------- list ---------------- */}
          <Card className="max-h-[70vh] divide-y divide-line overflow-y-auto">
            {shown.length === 0 && <p className="p-4 text-sm text-muted">Nothing in this stage.</p>}
            {shown.map((l) => (
              <button key={l.id} onClick={() => setSelId(l.id)}
                className={`block w-full px-4 py-3 text-left transition-colors ${selId === l.id ? "bg-paper-2" : "hover:bg-paper-2/60"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13.5px] font-semibold">{l.name}</span>
                  <Badge tone={STAGE_TONE[stageOf(l.status)]}>{STAGE_LABEL[stageOf(l.status)]}</Badge>
                </div>
                <div className="mt-0.5 truncate text-[12px] text-muted">
                  {l.productTitle || l.message.slice(0, 60) || "General enquiry"}
                </div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-ink/40">
                  {new Date(l.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                  {l.quotedPrice != null && <span className="text-blue-deep">· quoted £{l.quotedPrice}</span>}
                  {l.lastEmailedAt && <span className="text-success">· emailed</span>}
                </div>
              </button>
            ))}
          </Card>

          {/* ---------------- detail ---------------- */}
          {sel ? <LeadDetail key={sel.id} lead={sel} patch={patch} /> : <Card className="p-6 text-sm text-muted">Pick a lead.</Card>}
        </div>
      )}
    </div>
  );
}

function LeadDetail({ lead, patch }: { lead: Lead; patch: (id: string, d: Record<string, unknown>) => Promise<boolean> }) {
  const [notes, setNotes] = useState(lead.notes);
  const [quoted, setQuoted] = useState(lead.quotedPrice == null ? "" : String(lead.quotedPrice));
  const [subject, setSubject] = useState(lead.aiDraftSubject);
  const [body, setBody] = useState(lead.aiDraftBody);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "warning" | "danger" | "info"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const draft = async () => {
    setDrafting(true); setMsg(null);
    try {
      const r = await fetch(`/api/admin/leads/${lead.id}/draft`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tone: "danger", text: j.error || "Drafting failed." }); return; }
      setSubject(j.subject); setBody(j.body);
      setMsg(j.grounded?.withheld
        ? { tone: "info", text: "This product is call-for-price — the draft has an [ADD YOUR PRICE] gap for your personal quote." }
        : { tone: "success", text: "Draft ready — edit anything, then send." });
    } catch { setMsg({ tone: "danger", text: "Drafting failed — check the connection." }); }
    finally { setDrafting(false); }
  };

  const send = async () => {
    setSending(true); setMsg(null);
    try {
      const r = await fetch(`/api/admin/leads/${lead.id}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) { setMsg({ tone: "success", text: `Sent to ${lead.email} from the shop's Outlook.` }); await patch(lead.id, {}); location.reload(); return; }
      if (j.reason === "not_connected") {
        setMsg({ tone: "info", text: "Outlook isn't connected yet (Settings → Integrations). Opening your own email app instead…" });
        openMailApp();
        return;
      }
      setMsg({ tone: "danger", text: j.error || "Send failed." });
    } catch { setMsg({ tone: "danger", text: "Send failed — check the connection." }); }
    finally { setSending(false); }
  };

  const openMailApp = () => {
    // Persist the edited draft + mark emailed (mailto can't confirm, the owner is the confirmation)
    void patch(lead.id, { aiDraftSubject: subject, aiDraftBody: body, markEmailed: true, ...(stageOf(lead.status) === "new" ? { status: "contacted" } : {}) });
    window.location.href = `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true); setTimeout(() => setCopied(false), 1600);
      void patch(lead.id, { aiDraftSubject: subject, aiDraftBody: body });
    } catch { /* clipboard blocked */ }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold">{lead.name}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-muted">
              {lead.email && <a className="text-blue-deep hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a>}
              {lead.phone && <a className="inline-flex items-center gap-1 text-blue-deep hover:underline" href={`tel:${lead.phone}`}><Phone size={12} />{lead.phone}</a>}
              <span className="font-mono text-[11px] text-ink/40">
                {new Date(lead.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · via {lead.source}
              </span>
            </p>
          </div>
          {lead.lastEmailedAt && (
            <Badge tone="success">emailed {new Date(lead.lastEmailedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</Badge>
          )}
        </div>

        <p className="mt-3 rounded-xl bg-paper-2/70 p-3.5 text-[13.5px] leading-relaxed text-ink/80">&ldquo;{lead.message}&rdquo;</p>

        {lead.productCode && (
          <p className="mt-3 text-[13px]">
            <span className="text-muted">About:</span>{" "}
            <strong>{lead.productTitle || lead.productCode}</strong>{" "}
            <span className="font-mono text-[11px] text-ink/45">({lead.productCode})</span>
            <a href={`/products?q=${encodeURIComponent(lead.productCode)}`} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-blue-deep hover:underline">
              view <ArrowUpRight size={11} />
            </a>
          </p>
        )}

        {/* pipeline controls */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {STAGES.map((s) => (
            <button key={s} onClick={() => void patch(lead.id, { status: s })}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${stageOf(lead.status) === s ? "bg-navy text-white" : "border border-line text-ink/70 hover:border-blue hover:text-blue-deep"}`}>
              {STAGE_LABEL[s]}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
            <PoundSterling size={13} className="text-blue-deep" /> Quoted
            <input value={quoted} onChange={(e) => setQuoted(e.target.value)} onBlur={() => void patch(lead.id, { quotedPrice: quoted })}
              inputMode="decimal" placeholder="—" className="w-24 rounded-lg border border-line px-2.5 py-1.5 text-right tabular-nums outline-none focus:border-blue" />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="text-[12px] font-semibold text-muted">Your notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => void patch(lead.id, { notes })}
            rows={2} placeholder="e.g. wants delivery Saturday, price-matching Currys…"
            className="mt-1 w-full rounded-xl border border-line px-3.5 py-2.5 text-[13px] outline-none focus:border-blue" />
        </label>
      </Card>

      {/* ---------------- the email ---------------- */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-blue-deep">Reply by email</h3>
          <Button small variant="secondary" onClick={draft} disabled={drafting}>
            {drafting ? <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Drafting…</span>
              : <span className="inline-flex items-center gap-1.5"><Sparkles size={13} /> {subject || body ? "Redraft with AI" : "Draft with AI"}</span>}
          </Button>
        </div>
        <p className="mt-1 text-[12px] text-muted">
          Grounded in the real product data — published prices are quoted exactly; withheld prices become an [ADD YOUR PRICE] gap. It never invents a number.
        </p>

        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject"
          className="mt-3 w-full rounded-xl border border-line px-3.5 py-2.5 text-[13.5px] font-semibold outline-none focus:border-blue" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} placeholder="Press “Draft with AI”, or write your own…"
          className="mt-2 w-full rounded-xl border border-line px-3.5 py-2.5 text-[13.5px] leading-relaxed outline-none focus:border-blue" />

        {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={send} disabled={sending || !subject || !body || !lead.email}>
            {sending ? <span className="inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Sending…</span>
              : <span className="inline-flex items-center gap-1.5"><Send size={14} /> Send via Outlook</span>}
          </Button>
          <Button variant="secondary" onClick={openMailApp} disabled={!subject || !body || !lead.email}>
            <span className="inline-flex items-center gap-1.5"><Mail size={14} /> Open in my email app</span>
          </Button>
          <Button variant="ghost" onClick={copyEmail} disabled={!subject || !body}>
            <span className="inline-flex items-center gap-1.5">{copied ? <Check size={14} className="text-success" /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</span>
          </Button>
          {!lead.email && <span className="text-[12px] text-warning">No email on this lead — phone them instead.</span>}
        </div>
      </Card>
    </div>
  );
}
