import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { cronAuthorised } from "@/lib/cron-auth";
import { runPricewire } from "@/lib/price-watch/pricewire-run";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Every morning (vercel.json: 05:00–05:59 UTC, before the 06:00 summary):
 * Pricewire reads Bosch, Neff and Siemens prices from the sites the owner
 * chose, and the price agent applies them (lib/price-watch/pricewire-run.ts).
 */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const out = await runPricewire(await getPrisma(), { deadlineMs: 230_000, by: "price-agent (Pricewire, 05:00 run)" });
  return NextResponse.json({ ok: true, ...out });
}
