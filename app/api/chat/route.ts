import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { getPrisma } from "@/lib/prisma";
import { getBusiness } from "@/lib/repo";
import { getAdmin } from "@/lib/auth";
import { buildSystemPrompt, factsBlock, sourcesFor, plainReply } from "@/lib/chat/prompt";
import { findForChat, checkReply, type Found } from "@/lib/chat/finder";
import { callAssistant, groqConfigured, type ChatMsg } from "@/lib/chat/groq";
import { rateLimit, clientIp } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";

// A reply that admits a gap ("I can't find…", "we don't have information…") —
// logged as "unsure" so the owner sees what the shop's data couldn't answer.
// "Can't confirm stock" is the house rule, not a gap, so it doesn't count.
const isUnsure = (reply: string) =>
  /(can(?:no|['’])t|cannot|unable to)\s+(?:confirm|find|see|locate)|(?:don['’]t|do not)\s+(?:have|see)\s+(?:any\s+)?(?:information|details)|not (?:listed|something we (?:list|stock|sell))/i
    .test(reply.replace(/(?:can(?:no|['’])t|cannot|unable to) confirm (?:the |live |current )?(?:stock|availability)/gi, ""));

export async function POST(req: Request) {
  const gate = rateLimit("chat", clientIp(req), 20, 60_000); // 20 / minute
  if (!gate.ok) return NextResponse.json({ error: "Too many messages — please slow down." }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const history: ChatMsg[] = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8).map((m: any) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  // Cap the single-message fallback too: it reaches the catalogue search and the
  // paid Groq API, so an uncapped body.message is an anonymous cost/CPU amplifier.
  const userMsg = ([...history].reverse().find((m) => m.role === "user")?.content || String(body.message || "")).slice(0, 2000);
  if (!userMsg) return NextResponse.json({ error: "No message provided" }, { status: 400 });

  // The owner's audit trail (Admin → Chatbot): the tab's conversation id, the
  // page, where the visit came from — nothing that identifies the visitor. The
  // traffic tag is public input, so only the shapes the site itself stamps pass
  // (as /api/track). The owner trying it from the admin is marked, not counted.
  const started = Date.now();
  const conversationId = /^[A-Za-z0-9_-]{8,64}$/.test(String(body.conversationId || "")) ? String(body.conversationId) : randomUUID();
  const page = typeof body.page === "string" && /^\/(?![/\\])/.test(body.page) ? body.page.slice(0, 200) : ""; // a path on this site, not "//elsewhere"
  const tag = String(body.source || "").trim().toLowerCase();
  const source = (await getAdmin().catch(() => null)) ? "admin" : /^[a-z0-9][a-z0-9._-]{0,39}$/.test(tag) ? tag : "";
  const log = (t: { answer: string; outcome: string; provider?: string; found?: Found | null; sources?: ReturnType<typeof sourcesFor> }) =>
    after(async () => {
      try {
        const db = await getPrisma();
        await db.chatTurn.create({ data: {
          conversationId, question: userMsg, answer: t.answer, outcome: t.outcome, provider: t.provider || "",
          products: (t.sources || []).filter((s) => s.productCode).map((s) => ({ code: s.productCode, title: s.title, url: s.url })),
          understood: t.found ? { ...t.found.understood, codes: t.found.codes } : {},
          latencyMs: Date.now() - started, page, source,
        } });
      } catch (e) { console.error("chat: audit log failed —", String((e as Error)?.message || e)); }
    });

  const business = await getBusiness();
  if (!groqConfigured()) {
    const answer = `I can't reach the assistant right now — please call the store on ${business.phone} and we'll help straight away.`;
    log({ answer, outcome: "fallback" });
    return NextResponse.json({ reply: answer, sources: [] });
  }

  let found: Found | null = null;
  try {
    // The exact half first — codes, brand, department, budget, keywords, against
    // the live catalogue — then the model writes the reply from those facts only.
    found = await findForChat(history, userMsg);
    const system = `${buildSystemPrompt(business)}\n\nSTORE DATA:\n${factsBlock(found)}`;
    const turns: ChatMsg[] = history.length ? history : [{ role: "user", content: userMsg }];
    let { text, provider }: { text: string; provider: string } = await callAssistant([{ role: "system", content: system }, ...turns], { timeoutMs: 20000, maxTokens: 450 });
    let outcome = "answered";
    // Then checked: a code or price the facts don't hold never reaches the
    // customer. One retry, told exactly what was wrong; then the plain facts.
    const problems = await checkReply(text, found, userMsg);
    if (problems.length) {
      outcome = "corrected";
      console.warn("chat: draft named", problems.join(", "), "— asking again");
      const again = await callAssistant([{ role: "system", content: `${system}\n\nCORRECTION: a draft of this answer mentioned ${problems.join(", ")}, which the STORE DATA does not contain. Use only product codes and prices exactly as they appear in the STORE DATA.` }, ...turns], { timeoutMs: 15000, maxTokens: 450 }).catch(() => null);
      if (again?.text && !(await checkReply(again.text, found, userMsg)).length) ({ text, provider } = again);
      else { text = plainReply(found, business.phone); provider = ""; }
    }
    const reply = text || `Please call ${business.phone} to confirm.`;
    if (outcome === "answered" && found.searched && !found.products.length && !found.knowledge.length) outcome = "no_match";
    else if (outcome === "answered" && isUnsure(reply)) outcome = "unsure";
    const sources = sourcesFor(reply, found);
    log({ answer: reply, outcome, provider, found, sources });
    return NextResponse.json({ reply, sources });
  } catch (e) {
    // Log it. A silent catch here is exactly how the assistant sat dead for days
    // behind a friendly sentence — the customer sees the fallback either way,
    // but we should never have to guess why.
    console.error("chat: replying with fallback —", String((e as Error)?.message || e));
    const answer = `Sorry — I'm having trouble right now. Please call the store on ${business.phone} and we'll help.`;
    log({ answer, outcome: "fallback", found });
    return NextResponse.json({ reply: answer, sources: [] });
  }
}
