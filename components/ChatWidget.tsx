"use client";
import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Phone, Sparkles } from "lucide-react";
import { telHref } from "@/lib/format";
import { adSource } from "@/lib/ad-source";

type Msg = { role: "user" | "assistant"; content: string; sources?: { title: string; url: string; productCode: string }[] };

export default function ChatWidget({ phone }: { phone: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", content: `Hi! I can help you find appliances and answer questions about the store. Availability and price are always confirmed by phone — call ${phone} anytime.` }]);
  const boxRef = useRef<HTMLDivElement>(null);
  // Groups this tab's questions into one conversation in Admin → Chatbot. Random, per tab; identifies no one.
  const conversationId = useRef("");
  useEffect(() => { boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, open]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim(); if (!text || busy) return;
    const next = [...msgs, { role: "user", content: text } as Msg];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      conversationId.current ||= crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        messages: next.map((m) => ({ role: m.role, content: m.content })),
        conversationId: conversationId.current, page: location.pathname, source: adSource(),
      }) });
      const j = await r.json();
      setMsgs((m) => [...m, { role: "assistant", content: j.reply || `Please call ${phone} to confirm.`, sources: j.sources }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: `Sorry — I'm having trouble. Please call the store on ${phone}.` }]);
    } finally { setBusy(false); }
  }

  return (
    <>
      {!open && (
        // "Ask us" pill in Euronics yellow (the owner's request, modelled on an "Ask AI" launcher).
        // z-[70] sits it above the cookie bar (z-[60]), which keeps this corner free for it.
        // data-site-chrome: not shown in the back office, where it covered admin buttons.
        <button data-site-chrome onClick={() => setOpen(true)} aria-label="Open chat — ask us a question"
          className="fixed bottom-5 right-5 z-[70] flex h-14 items-center gap-2.5 rounded-full bg-[#ffd200] py-1.5 pl-4 pr-1.5 text-navy shadow-[0_8px_24px_rgba(8,21,56,.28)] ring-1 ring-navy/10 transition hover:scale-[1.03] hover:bg-[#ffdb33]">
          <Sparkles size={18} className="text-navy" aria-hidden />
          <span className="font-display text-[16px] font-extrabold tracking-tight">Ask us</span>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue text-[#ffd200]"><MessageCircle size={20} aria-hidden /></span>
        </button>
      )}
      {open && (
        <div data-site-chrome className="fixed bottom-5 right-5 z-[70] flex h-[560px] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-blue px-4 py-3 text-paper">
            <div><div className="font-display text-sm font-semibold">Store Assistant</div><div className="text-[11px] text-paper/60">Grounded in our real product data</div></div>
            <button onClick={() => setOpen(false)} aria-label="Close chat" className="text-paper/70 hover:text-paper"><X size={18} /></button>
          </div>
          <div ref={boxRef} className="flex-1 space-y-3 overflow-y-auto bg-paper p-4">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : ""}>
                <div className={`inline-block max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-left text-sm ${m.role === "user" ? "bg-blue text-paper" : "bg-white border border-line"}`}>{m.content}</div>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.sources.map((s, j) => <a key={j} href={s.url} className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px] text-ink/70 hover:border-blue hover:text-blue">{s.productCode || s.title}</a>)}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="text-xs text-ink/70">Assistant is typing…</div>}
          </div>
          <div className="border-t border-line p-3">
            <a href={telHref(phone)} className="mb-2 flex items-center justify-center gap-2 rounded-full bg-blue/15 px-3 py-1.5 text-xs font-medium text-navy"><Phone size={13} /> Call the store: {phone}</a>
            <form onSubmit={send} className="flex items-center gap-2">
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about a product…" className="flex-1 rounded-full border border-line px-3 py-2 text-sm outline-none focus:border-blue" />
              <button type="submit" disabled={busy} className="flex h-9 w-9 items-center justify-center rounded-full bg-blue text-paper disabled:opacity-50" aria-label="Send"><Send size={15} /></button>
            </form>
            <p className="mt-2 text-center text-[10.5px] text-muted">Chats are saved so we can check and improve our answers. <a href="/privacy" className="underline underline-offset-2">Privacy</a></p>
          </div>
        </div>
      )}
    </>
  );
}
