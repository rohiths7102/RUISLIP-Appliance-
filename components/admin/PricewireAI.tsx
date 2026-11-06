"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Notice, type Tone } from "@/components/admin/ui";
import type { ImportSummary, QueueFlag, QueueItem } from "@/lib/price-watch/pricewire-ai";
import type { Proposal } from "@/lib/price-watch/pricewire-agent";

/**
 * Admin → Pricewire → AI desk.
 *   upload    any price document; its retail prices go to the queue
 *   assistant a chat that looks prices up and proposes offers
 *   queue     every AI price waiting; Apply goes through the guarded
 *             price-watch apply route, Dismiss drops it
 * The AI never changes a price itself (lib/price-watch/pricewire-ai.ts).
 */
type Msg = { tone: "success" | "warning" | "danger" | "info"; text: string } | null;
type Line = { role: "user" | "assistant"; text: string; proposals?: Proposal[]; tools?: string[] };

const money = (n: number | null | undefined) => (typeof n !== "number" ? "no price" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`);
const FLAG: Record<QueueFlag, [string, Tone]> = {
  call_for_price: ["call for price", "danger"], below_cost: ["below cost", "danger"], euronics_agency: ["Euronics agency price", "warning"],
  big_move: ["over 30% change", "warning"], close_match: ["close model match", "warning"], hidden: ["hidden", "neutral"],
  owner_set: ["you set this price", "info"], first_price: ["first price", "info"],
};
const SAFE = (it: QueueItem) => !it.flags.some((f) => f === "call_for_price" || f === "below_cost" || f === "euronics_agency" || f === "close_match" || f === "big_move");
const REASON: Record<string, string> = {
  below_floor: "below cost plus margin", poa_category: "call for price", vat_basis_mismatch: "VAT basis unclear", invalid_proposal: "not a usable price",
  unusable_observation: "suggestion no longer valid", not_found: "product gone", no_observation: "suggestion gone", poa_unknown: "call-for-price status unknown",
};
const TOOL_LABEL: Record<string, string> = { search_products: "searched products", product_report: "read a product's prices", offer_opportunities: "looked for offers", propose_price: "proposed a price" };
const PROMPTS = [
  "Where are we dearer than the other sources? Suggest prices.",
  "Which products get views but no calls? What should I change?",
  "Suggest 5 Bosch offers for this week.",
  "Which products have a source price but show no price?",
];

/** The assistant writes light Markdown: **bold** and "- " bullets. Rendered as text nodes, never as HTML. */
function Reply({ text }: { text: string }) {
  const bold = (s: string) => s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
  return (
    <div className="space-y-1.5 leading-relaxed">
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split("\n");
        return lines.every((l) => /^\s*[-*•] /.test(l))
          ? <ul key={i} className="ml-4 list-disc space-y-1">{lines.map((l, k) => <li key={k}>{bold(l.replace(/^\s*[-*•] /, ""))}</li>)}</ul>
          : <p key={i} className="whitespace-pre-wrap">{bold(block)}</p>;
      })}
    </div>
  );
}

async function json(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  return { ok: r.ok, j: await r.json().catch(() => ({})) };
}

/* ------------------------------------------------------------ upload */

function Upload({ ready, onStaged }: { ready: boolean; onStaged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [res, setRes] = useState<ImportSummary | null>(null);
  const [err, setErr] = useState("");
  const pick = useRef<HTMLInputElement>(null);

  async function send(file: File) {
    setBusy(true); setErr(""); setRes(null);
    const fd = new FormData(); fd.append("file", file);
    const { ok, j } = await json("/api/admin/pricewire/ai/import", { method: "POST", body: fd });
    setBusy(false);
    if (!ok) { setErr(j.error || "Couldn't read that file."); return; }
    setRes(j); onStaged();
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">Upload a price document</h3>
      <p className="mt-0.5 text-xs text-muted">A supplier price list, promotion flyer, quote, email or a screenshot of another shop. The AI reads every model and price and puts them below for you to check.</p>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f && ready && !busy) send(f); }}
        className={`mt-3 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${drag ? "border-blue bg-blue/5" : "border-line"}`}>
        <p className="text-sm text-ink/80">{busy ? "Reading the document… this can take a minute for a long one." : "Drop a file here"}</p>
        <p className="mt-1 text-[11px] text-muted">PDF · photo or screenshot · Excel · CSV · Word · text — up to 15 MB</p>
        <Button small variant="secondary" className="mt-3" disabled={!ready || busy} onClick={() => pick.current?.click()}>{busy ? "Reading…" : "Choose file"}</Button>
        <input ref={pick} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.csv,.docx,.txt,.tsv,.eml"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) send(f); }} />
      </div>
      {err && <Notice tone="danger" className="mt-3">{err}</Notice>}
      {res && (
        <div className="mt-3 rounded-xl border border-line p-3 text-xs text-ink/80">
          <p className="font-medium text-ink">{res.kind}{res.supplier ? ` · ${res.supplier}` : ""} <span className="font-normal text-muted">({res.via === "table" ? "read directly" : "read by AI"})</span></p>
          <p className="mt-1">{res.rows} lines · {res.matched} matched to our products · <b>{res.staged} prices to review</b>
            {res.unchanged ? ` · ${res.unchanged} already the same` : ""}{res.trade ? ` · ${res.trade} trade prices skipped` : ""}{res.callForPrice ? ` · ${res.callForPrice} call-for-price skipped` : ""}{res.closeMatches ? ` · ${res.closeMatches} close-code matches` : ""}</p>
          {!res.pricesIncludeVat && <p className="mt-1 text-warning">Prices in this file exclude VAT; VAT is added before they reach the site.</p>}
          {res.notes && <p className="mt-1 text-muted">Notes: {res.notes}</p>}
          {res.unmatched.length > 0 && (
            <details className="mt-2"><summary className="cursor-pointer text-blue-deep">{res.unmatched.length} models we don't sell</summary>
              <p className="mt-1 text-muted">{res.unmatched.map((u) => `${u.model}${u.price ? ` (${money(u.price)})` : ""}`).join(", ")}</p></details>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ assistant */

function Assistant({ ready, onProposed }: { ready: boolean; onProposed: () => void }) {
  const [history, setHistory] = useState<unknown[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [lines, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true); setErr(""); setText("");
    setLines((l) => [...l, { role: "user", text: question }]);
    const { ok, j } = await json("/api/admin/pricewire/ai/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history, text: question }) });
    setBusy(false);
    if (!ok) { setErr(j.error || "The assistant didn't answer."); setLines((l) => l.slice(0, -1)); setText(question); return; }
    setHistory(j.messages);
    const tools = [...new Set<string>((j.tools || []).map((t: any) => TOOL_LABEL[t.name] || t.name))];
    setLines((l) => [...l, { role: "assistant", text: j.reply || "(no answer)", proposals: j.proposals, tools }]);
    if (j.proposals?.length) onProposed();
  }

  return (
    <div className="flex min-h-[420px] flex-col">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ink">Ask Pricewire</h3>
        {lines.length > 0 && <button type="button" className="text-xs text-muted hover:text-blue-deep" onClick={() => { setHistory([]); setLines([]); setErr(""); }}>New chat</button>}
      </div>
      <p className="mt-0.5 text-xs text-muted">It reads your prices, the other sources, views and calls, and suggests offers. Suggested prices land in the queue below — nothing changes until you apply.</p>
      <div className="mt-3 flex-1 space-y-3 overflow-y-auto rounded-xl bg-paper-2/60 p-3" style={{ maxHeight: 460 }}>
        {!lines.length && (
          <div className="flex flex-wrap gap-2">
            {PROMPTS.map((p) => <button key={p} type="button" disabled={!ready} onClick={() => ask(p)} className="rounded-full border border-line bg-white px-3 py-1.5 text-left text-xs text-ink/80 hover:border-blue hover:text-blue-deep disabled:opacity-50">{p}</button>)}
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={l.role === "user" ? "ml-8 rounded-xl bg-navy px-3 py-2 text-sm text-paper" : "mr-4 rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink"}>
            {l.tools && l.tools.length > 0 && <p className="mb-1 text-[11px] text-muted">{l.tools.join(" · ")}</p>}
            {l.role === "assistant" ? <Reply text={l.text} /> : <p className="whitespace-pre-wrap leading-relaxed">{l.text}</p>}
            {l.proposals && l.proposals.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs">
                {l.proposals.map((p, k) => <li key={k}><b>{p.code}</b> {money(p.from)} → <b>{money(p.to)}</b> <span className="text-muted">— in the queue</span></li>)}
              </ul>
            )}
          </div>
        ))}
        {busy && <p className="text-xs text-muted">Thinking and looking things up…</p>}
        <div ref={end} />
      </div>
      {err && <Notice tone="danger" className="mt-2">{err}</Notice>}
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} disabled={!ready || busy} placeholder={ready ? "e.g. What should the WGG24409GB cost?" : "Add the AI key to use the assistant"}
          className="flex-1 rounded-full border border-line bg-white px-4 py-2 text-sm" maxLength={4000} />
        <Button small disabled={!ready || busy || !text.trim()}>Send</Button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------ queue */

function Queue({ items, reload }: { items: QueueItem[]; reload: () => void }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const key = (it: QueueItem) => `${it.productId}|${it.sourceId}`;
  const chosen = items.filter((it) => sel.has(key(it)));
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function apply() {
    if (!chosen.length || !confirm(`Put ${chosen.length} new price${chosen.length === 1 ? "" : "s"} on the website now?`)) return;
    setBusy(true); setMsg(null);
    let applied = 0; const refused: Record<string, number> = {};
    for (const sourceId of [...new Set(chosen.map((c) => c.sourceId))]) {
      const ids = chosen.filter((c) => c.sourceId === sourceId).map((c) => c.productId);
      for (let i = 0; i < ids.length; i += 200) {
        const { ok, j } = await json("/api/admin/price-watch/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productIds: ids.slice(i, i + 200), sourceId }) });
        if (!ok) { refused[j.error || "error"] = (refused[j.error || "error"] || 0) + ids.slice(i, i + 200).length; continue; }
        for (const r of j.results || []) {
          if (r.status === "applied") applied++;
          else if (r.status === "refused") for (const why of r.reasons?.length ? r.reasons : ["refused"]) refused[REASON[why] || why.replace(/_/g, " ")] = (refused[REASON[why] || why.replace(/_/g, " ")] || 0) + 1;
        }
      }
    }
    setBusy(false); setSel(new Set());
    const held = Object.entries(refused).map(([k, n]) => `${n} ${k}`).join(", ");
    setMsg({ tone: held ? "warning" : "success", text: `${applied} price${applied === 1 ? "" : "s"} now on the website.${held ? ` Not applied: ${held}.` : ""}` });
    reload(); router.refresh();
  }
  async function dismiss() {
    if (!chosen.length) return;
    setBusy(true); setMsg(null);
    const { ok, j } = await json("/api/admin/pricewire/ai/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dismiss", items: chosen.map((c) => ({ productId: c.productId, sourceId: c.sourceId })) }) });
    setBusy(false); setSel(new Set());
    setMsg(ok ? { tone: "info", text: `Dismissed ${chosen.length}.` } : { tone: "danger", text: j.error || "Couldn't dismiss." });
    reload();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold text-ink">Waiting for review <span className="font-normal text-muted">({items.length})</span></h3>
        <Button small variant="ghost" disabled={!items.length || busy} onClick={() => setSel(new Set(items.filter(SAFE).map(key)))}>Select the safe ones</Button>
        <Button small variant="ghost" disabled={!sel.size || busy} onClick={() => setSel(new Set())}>Clear</Button>
        <Button small variant="secondary" disabled={!chosen.length || busy} onClick={dismiss}>Dismiss</Button>
        <Button small disabled={!chosen.length || busy} onClick={apply}>{busy ? "Working…" : `Apply ${chosen.length || ""}`.trim()}</Button>
      </div>
      {msg && <Notice tone={msg.tone} className="mt-2">{msg.text}</Notice>}
      {!items.length ? <p className="mt-3 text-xs text-muted">Nothing waiting. Upload a document or ask the assistant for offers.</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
              <th className="w-8 py-2"><input type="checkbox" aria-label="Select all" checked={sel.size === items.length && items.length > 0} onChange={(e) => setSel(e.target.checked ? new Set(items.map(key)) : new Set())} /></th>
              <th className="py-2">Product</th><th className="py-2 pl-4 text-right">Now</th><th className="py-2 pl-4 text-right">Suggested</th><th className="py-2 pl-4 text-right">Change</th><th className="py-2 pl-4">From</th>
            </tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={key(it)} className="border-b border-line/70 align-top">
                  <td className="py-2"><input type="checkbox" aria-label={`Select ${it.code}`} checked={sel.has(key(it))} onChange={() => toggle(key(it))} /></td>
                  <td className="py-2 pr-3">
                    <a href={`/products/${it.slug}`} target="_blank" rel="noreferrer" className="font-medium text-ink hover:text-blue-deep">{it.code}</a>
                    <span className="ml-1 text-xs text-muted">{it.brand}</span>
                    <p className="line-clamp-1 text-xs text-muted">{it.title}</p>
                    {it.flags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{it.flags.map((f) => <Badge key={f} tone={FLAG[f][1]}>{FLAG[f][0]}</Badge>)}</div>}
                  </td>
                  <td className="py-2 pl-4 text-right tabular-nums text-muted">{money(it.from)}</td>
                  <td className="py-2 pl-4 text-right font-semibold tabular-nums">{money(it.to)}</td>
                  <td className={`py-2 pl-4 text-right tabular-nums ${it.changePct === null ? "text-muted" : it.changePct < 0 ? "text-success" : "text-warning"}`}>{it.changePct === null ? "new" : `${it.changePct > 0 ? "+" : ""}${it.changePct}%`}</td>
                  <td className="py-2 pl-4 text-xs text-muted"><span className="text-ink/80">{it.sourceId === "ai-import" ? "Document" : it.sourceId === "pricing-rules" ? "Rule" : "Assistant"}</span><p className="line-clamp-2">{it.note}</p></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ desk */

/** Tells the review queue (and the module bar's count) that suggestions changed. */
export const queueChanged = () => window.dispatchEvent(new Event("pricewire:queue-changed"));

/** Pricewire → AI desk: document upload and the assistant. Their prices land in the review queue. */
export function AiDesk() {
  const [ready, setReady] = useState(true);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { json("/api/admin/pricewire/ai/queue").then(({ ok, j }) => { if (ok) setReady(!!j.ready); setLoaded(true); }); }, []);
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge tone={ready ? "success" : "warning"}>{ready ? "Claude Haiku 5.5 ready" : "AI key missing"}</Badge>
        <p className="text-xs text-muted">The AI suggests; you decide. Every price is checked against cost, call-for-price and VAT before it goes live.</p>
      </div>
      {loaded && !ready && <Notice tone="warning" className="mt-3">Add <code>ANTHROPIC_API_KEY</code> to the site&apos;s environment settings (and restart) to turn on document reading and the assistant. The review queue works without it.</Notice>}
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Upload ready={ready} onStaged={queueChanged} />
        <Assistant ready={ready} onProposed={queueChanged} />
      </div>
    </div>
  );
}

/** Pricewire → Review queue: every suggested price from documents, the assistant and pricing rules. */
export function ReviewQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const load = useCallback(async () => {
    const { ok, j } = await json("/api/admin/pricewire/ai/queue");
    if (ok) setItems(j.items || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener("pricewire:queue-changed", load); return () => window.removeEventListener("pricewire:queue-changed", load); }, [load]);
  return <Queue items={items} reload={() => { load(); queueChanged(); }} />;
}
