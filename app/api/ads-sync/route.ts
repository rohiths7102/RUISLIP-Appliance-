import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getPrisma } from "@/lib/prisma";
import { saveAdsPayload } from "@/lib/ads-store";
export const dynamic = "force-dynamic";

/**
 * Receives the nightly push from the Google Ads Script running inside the
 * shop's Ads account (lib/ads-sync-script.ts). Outside /api/admin on purpose:
 * Google's servers have no admin cookie and no fixed IP, so the script proves
 * itself with ADS_SYNC_SECRET instead.
 *
 *   POST { campaignDays: [...], reports: { searchTerms: [...], … }, geoNames: { id: "HA4" } }
 *   header x-ads-sync-secret: <ADS_SYNC_SECRET>
 */
function authorised(req: Request): boolean {
  const secret = process.env.ADS_SYNC_SECRET || "";
  const got = req.headers.get("x-ads-sync-secret") || "";
  if (secret.length < 24) return false; // unset or too weak: refuse everything
  const a = Buffer.from(got), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.campaignDays)) return NextResponse.json({ error: "Expected { campaignDays, reports }" }, { status: 400 });
  try {
    const saved = await saveAdsPayload(await getPrisma(), body);
    return NextResponse.json({ ok: true, ...saved });
  } catch (e) {
    console.error("ads-sync", e);
    return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
  }
}
