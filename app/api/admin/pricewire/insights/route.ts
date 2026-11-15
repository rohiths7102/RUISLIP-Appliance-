import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { pricewireAlerts, priceHistory } from "@/lib/price-watch/pricing-rules";
import { marketInsights } from "@/lib/price-watch/market";
import { priceEffects, writeEffectsNote } from "@/lib/price-watch/effects";
import { runGeoAgent } from "@/lib/geo-faq";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?view=market — trends, Ruislip comparison, what to promote. GET ?view=alerts — what needs the owner's eye. GET ?code=WGG24409GB — that product's price history (90 days). */
export async function GET(req: Request) {
  const gate = await requireAdminApi(req, { limit: 60, bucket: "pricewire-insights" });
  if ("response" in gate) return gate.response;
  const q = new URL(req.url).searchParams;
  const db = await getPrisma();
  const code = (q.get("code") || "").trim();
  if (code) {
    const h = await priceHistory(db, code);
    return h ? NextResponse.json(h) : NextResponse.json({ error: `No product with model code ${code}.` }, { status: 404 });
  }
  if (q.get("view") === "market") return NextResponse.json(await marketInsights(db));
  if (q.get("view") === "effects") return NextResponse.json(await priceEffects(db));
  return NextResponse.json({ alerts: await pricewireAlerts(db) });
}

/** POST { action: "effects-note" } — the AI writes this week's note now. { action: "geo" } — write up to 3 buyer FAQs now. */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 10, bucket: "pricewire-insights-ai" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const db = await getPrisma();
  const by = `${(gate as any).admin?.email || "admin"} (Market)`;
  if (body?.action === "effects-note") return NextResponse.json(await writeEffectsNote(db, by));
  if (body?.action === "geo") return NextResponse.json(await runGeoAgent(db, { by }));
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
