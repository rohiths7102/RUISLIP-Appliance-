import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { runAgent, validHistory } from "@/lib/price-watch/pricewire-agent";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST { history, text } — one turn with the Pricewire assistant. `history` is
 * the conversation the previous turn returned, unchanged; the reply carries
 * the new full conversation. The assistant can only propose prices.
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 30, windowMs: 60_000, bucket: "pricewire-ai-agent" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const text = String(body?.text || "").trim().slice(0, 4000);
  const history = body?.history ?? [];
  if (!text) return NextResponse.json({ error: "Type a question first." }, { status: 400 });
  if (!validHistory(history)) return NextResponse.json({ error: "This conversation is too long or damaged — start a new one." }, { status: 400 });
  try {
    return NextResponse.json(await runAgent(await getPrisma(), history, text, gate.admin.email));
  } catch (e) {
    console.error("pricewire agent", e);
    return NextResponse.json({ error: (e as Error).message?.slice(0, 300) || "The assistant didn't answer — try again." }, { status: 502 });
  }
}
