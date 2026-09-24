import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { callGroq, groqConfigured } from "@/lib/chat/groq";
import { searchAnalytics } from "@/lib/search-console";
import { SITE } from "@/lib/seo";
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
    const db = await getPrisma();
    const row = kind === "product"
      ? await db.product.findUnique({ where: { id }, select: { title: true, brand: true, category: true, subcategory: true, priceNow: true, shortDescription: true, warranty: true } })
      : await db.category.findUnique({ where: { id }, select: { name: true, description: true, productCount: true } });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const queries = ((await searchAnalytics(db, "query", 28, `${SITE().replace(/\/+$/, "")}${path}`).catch(() => null)) || [])
      .sort((a, b) => b.impressions - a.impressions).slice(0, 8).map((q) => q.key);

    const facts = kind === "product"
      ? `Product: ${row.brand} ${row.title}. Department: ${row.category} / ${row.subcategory}. ${row.priceNow != null ? `Price £${row.priceNow}.` : "Price on request."} ${row.warranty ? `Warranty: ${row.warranty}.` : ""} ${row.shortDescription || ""}`
      : `Department page: ${row.name} (${row.productCount} models). ${row.description || ""}`;
    const text = await callGroq([
      { role: "system", content: `You write search titles and descriptions for Jyotsna Electrical (Euronics Ruislip), a family-run appliance shop in South Ruislip, West London, that delivers in its own van and fits appliances across the HA, UB, W3–W6, WD3–WD24 and SL postcodes. Rules: title at most 58 characters (count them) with the product or department first and a local hook (Ruislip / West London / delivered & fitted); description at most 150 characters, plain British English, answers the search, no exclamation marks, no claims not in the facts. Reply with JSON only: {"title": "...", "description": "..."}` },
      { role: "user", content: `Facts: ${facts}\nSearches Google matched this page to: ${queries.length ? queries.join("; ") : "none recorded yet"}` },
    ], { timeoutMs: 20000, temperature: 0.4 });
    const j = JSON.parse((text.match(/\{[\s\S]*\}/) || ["{}"])[0]);
    const title = String(j.title || "").replace(/\s+/g, " ").trim().slice(0, 70);
    const description = String(j.description || "").replace(/\s+/g, " ").trim().slice(0, 170);
    if (!title) return NextResponse.json({ error: "The AI didn't return a usable title." }, { status: 502 });
    return NextResponse.json({ title, description, queries });
  } catch (e: any) {
    console.error("seo suggest", e);
    return NextResponse.json({ error: e?.message || "The AI didn't answer." }, { status: 502 });
  }
}
