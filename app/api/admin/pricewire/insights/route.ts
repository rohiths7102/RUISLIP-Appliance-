import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { pricewireAlerts, priceHistory } from "@/lib/price-watch/pricing-rules";
export const dynamic = "force-dynamic";

/** GET ?view=alerts — what needs the owner's eye. GET ?code=WGG24409GB — that product's price history (90 days). */
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
  return NextResponse.json({ alerts: await pricewireAlerts(db) });
}
