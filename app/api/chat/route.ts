import { NextResponse } from "next/server";
import { searchIndex } from "@/lib/rag/index";
import { getBusiness } from "@/lib/repo";
import { buildSystemPrompt, buildContextBlock, extractSources } from "@/lib/chat/prompt";
import { callGroq, groqConfigured, type ChatMsg } from "@/lib/chat/groq";
import { shortlistHits } from "@/lib/chat/shortlist";
import { rateLimit, clientIp } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = rateLimit("chat", clientIp(req), 20, 60_000); // 20 / minute
  if (!gate.ok) return NextResponse.json({ error: "Too many messages — please slow down." }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const history: ChatMsg[] = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8).map((m: any) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  // Cap the single-message fallback too: it reaches BM25 retrieval and the paid
  // Groq API, so an uncapped body.message is an anonymous cost/CPU amplifier.
  const userMsg = ([...history].reverse().find((m) => m.role === "user")?.content || String(body.message || "")).slice(0, 2000);
  if (!userMsg) return NextResponse.json({ error: "No message provided" }, { status: 400 });

  const business = await getBusiness();
  if (!groqConfigured()) return NextResponse.json({ reply: `I can't reach the assistant right now — please call the store on ${business.phone} and we'll help straight away.`, sources: [] });

  try {
    // Keyword hits, PLUS a structured lookup for "X under £Y" questions. BM25
    // cannot reason about price, so on its own it answered "we have no washing
    // machines under £500" while the shop had 51 from £239.99 — it had scored
    // spare-part documents on the word "washing". shortlistHits asks the
    // database instead and leads the context with real, in-budget products.
    const [shortlist, keyword] = await Promise.all([
      shortlistHits(userMsg, 6).catch(() => [] as Awaited<ReturnType<typeof shortlistHits>>),
      searchIndex(userMsg, 6),
    ]);
    const seen = new Set(shortlist.map((h) => h.doc.sourceId));
    const hits = [...shortlist, ...keyword.filter((h) => !seen.has(h.doc.sourceId))].slice(0, 8);
    const system = `${buildSystemPrompt(business)}\n\nSTORE CONTEXT:\n${buildContextBlock(hits)}`;
    const messages: ChatMsg[] = [{ role: "system", content: system }, ...(history.length ? history : [{ role: "user", content: userMsg } as ChatMsg])];
    const reply = await callGroq(messages, { timeoutMs: 20000 });
    return NextResponse.json({ reply: reply || `Please call ${business.phone} to confirm.`, sources: extractSources(hits) });
  } catch (e) {
    // Log it. A silent catch here is exactly how the assistant sat dead for days
    // behind a friendly sentence — the customer sees the fallback either way,
    // but we should never have to guess why.
    console.error("chat: replying with fallback —", String((e as Error)?.message || e));
    return NextResponse.json({ reply: `Sorry — I'm having trouble right now. Please call the store on ${business.phone} and we'll help.`, sources: [] });
  }
}
