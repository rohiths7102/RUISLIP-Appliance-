import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { groqConfigured } from "@/lib/chat/groq";
import { suggestSeo } from "@/lib/seo-suggest";
export const dynamic = "force-dynamic";

/**
 * Admin → SEO → Suggest: a title and description for one page, written from
 * what the page really is (product or department) and the searches Google
 * matched it to in the last 28 days. Nothing is saved here — the owner reads
 * it, edits it, and presses Save.
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 20, windowMs: 60_000 });
  if ("response" in gate) return gate.response;
  if (!groqConfigured()) return NextResponse.json({ error: "No AI key is set (GROQ_API_KEY or GEMINI_API_KEY)." }, { status: 400 });
  const { kind, id, path } = await req.json().catch(() => ({}));
  if (!["product", "category"].includes(kind) || typeof id !== "string" || typeof path !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });

  try {
    const out = await suggestSeo(await getPrisma(), kind, id, path);
    return out ? NextResponse.json(out) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (e: any) {
    console.error("seo suggest", e);
    return NextResponse.json({ error: e?.message || "The AI didn't answer." }, { status: 502 });
  }
}
