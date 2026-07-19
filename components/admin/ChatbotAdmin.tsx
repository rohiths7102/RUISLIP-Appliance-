"use client";
import { useEffect, useState } from "react";
export default function ChatbotAdmin() {
  const [status, setStatus] = useState<any>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const [q, setQ] = useState("Do you have any quiet Bosch dishwashers?"); const [ans, setAns] = useState<any>(null); const [testing, setTesting] = useState(false);
  async function load() { try { const r = await fetch("/api/admin/rag/status"); if (r.ok) setStatus(await r.json()); } catch {} }
  useEffect(() => { load(); }, []);
  async function rebuild() { setBusy(true); setMsg(""); const r = await fetch("/api/admin/rag/rebuild", { method: "POST" }); setBusy(false); if (r.ok) { const j = await r.json(); setMsg(`Rebuilt ✓ — ${j.indexed} documents (${j.embedded ? "with embeddings" : "lexical mode"}).`); load(); } else setMsg("Rebuild failed — is the database running?"); }
  async function test() { setTesting(true); setAns(null); const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: q }] }) }); setTesting(false); setAns(r.ok ? await r.json() : { reply: "Request failed.", sources: [] }); }
  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-semibold">Chatbot / RAG</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[["Indexed docs", status?.documents ?? "—"], ["Groq", status?.groqConfigured ? "configured" : "not set"], ["Embeddings", status?.embeddings ? "on" : "lexical"], ["Last built", status?.lastBuilt ? new Date(status.lastBuilt).toLocaleDateString() : "—"]].map(([l, v]) => (
          <div key={l as string} className="rounded-2xl border border-line bg-white p-4"><div className="font-display text-lg">{v as any}</div><div className="text-xs text-ink/60">{l}</div></div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={rebuild} disabled={busy} className="rounded-full bg-navy px-5 py-2.5 text-sm font-medium text-paper disabled:opacity-50">{busy ? "Rebuilding…" : "Rebuild index"}</button>
        {msg && <span className="text-sm text-blue">{msg}</span>}
      </div>
      <div className="mt-8 rounded-2xl border border-line bg-white p-5">
        <div className="font-medium">Test the chatbot</div>
        <div className="mt-2 flex gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 rounded-full border border-line px-3 py-2 text-sm" /><button onClick={test} disabled={testing} className="rounded-full bg-blue px-4 py-2 text-sm font-medium text-navy disabled:opacity-50">{testing ? "…" : "Ask"}</button></div>
        {ans && (
          <div className="mt-3 rounded-xl bg-paper p-3 text-sm">
            <div>{ans.reply}</div>
            {ans.sources?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{ans.sources.map((s: any, i: number) => <a key={i} href={s.url} className="rounded-full border border-line bg-white px-2 py-0.5 text-xs">{s.productCode || s.title}</a>)}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
