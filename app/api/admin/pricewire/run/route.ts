import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { runPricewire } from "@/lib/price-watch/pricewire-run";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Read prices now": the 05:00 run on demand, for up to ~45 seconds — read the
 * sites, then let the price agent apply what changed, with the same checks and
 * daily limit (lib/price-watch/pricewire-run.ts). Prices are automatic since
 * 14 Nov 2026, so a press updates the shop, not just the waiting list.
 * Product pages not reached in time are read first on the next press.
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 6, bucket: "pricewire-run" });
  if ("response" in gate) return gate.response;
  const out = await runPricewire(await getPrisma(), { deadlineMs: 45_000, by: `${gate.admin.email} (Read prices now)` });
  if (typeof out.read === "string") return NextResponse.json({ error: `The read ${out.read}` }, { status: 502 });
  return NextResponse.json({ ...out.read, applied: out.applied, changed: out.changed });
}
