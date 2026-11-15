import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { callAssistant, providerOrder, CLAUDE_MODEL } from "@/lib/chat/groq";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ai/status — which AI answers the site's features, proved
 * with one tiny live call. After adding ANTHROPIC_API_KEY in Vercel and
 * redeploying, "answeredBy" should read "claude" (Claude Haiku).
 */
export async function GET(req: Request) {
  const gate = await requireAdminApi(req, { limit: 10, bucket: "ai-status" });
  if ("response" in gate) return gate.response;
  const order = providerOrder();
  const t0 = Date.now();
  try {
    const r = await callAssistant([{ role: "user", content: "Reply with the single word: ready" }], { maxTokens: 20, timeoutMs: 20000 });
    return NextResponse.json({ order, claudeModel: CLAUDE_MODEL, answeredBy: r.provider, reply: r.text.slice(0, 40), ms: Date.now() - t0 });
  } catch (e: any) {
    return NextResponse.json({ order, claudeModel: CLAUDE_MODEL, answeredBy: null, error: String(e?.message || e).slice(0, 200), ms: Date.now() - t0 }, { status: 502 });
  }
}
