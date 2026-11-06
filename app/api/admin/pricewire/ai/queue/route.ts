import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { aiQueue, aiReady, dismissQueued } from "@/lib/price-watch/pricewire-ai";
export const dynamic = "force-dynamic";

/** GET: the AI prices waiting for review. Applying them goes through /api/admin/price-watch/apply. */
export async function GET(req: Request) {
  const gate = await requireAdminApi(req, { limit: 60, windowMs: 60_000, bucket: "pricewire-ai-queue" });
  if ("response" in gate) return gate.response;
  return NextResponse.json({ ready: aiReady(), items: await aiQueue(await getPrisma()) });
}

/** POST { action: "dismiss", items: [{ productId, sourceId }] } */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 30, windowMs: 60_000, bucket: "pricewire-ai-queue" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body?.items) ? body.items.filter((x: any) => typeof x?.productId === "string" && typeof x?.sourceId === "string").slice(0, 500) : [];
  if (body?.action !== "dismiss" || !items.length) return NextResponse.json({ error: "Nothing to dismiss." }, { status: 400 });
  return NextResponse.json({ dismissed: await dismissQueued(await getPrisma(), items, gate.admin.email) });
}
