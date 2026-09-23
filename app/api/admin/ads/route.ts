import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { adsApiConfigured, blockSearch, pauseKeyword, syncFromApi } from "@/lib/google-ads-api";
export const dynamic = "force-dynamic";

/**
 * Admin → Google Ads actions over the direct API (lib/google-ads-api.ts):
 *   { action: "sync" }                              refresh every report now
 *   { action: "block_search", value: "search" }     exact-match negative
 *   { action: "pause_keyword", value: "agId~critId" }
 * Every change to the Ads account is written to the audit log.
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 20, windowMs: 60_000 });
  if ("response" in gate) return gate.response;
  if (!adsApiConfigured()) return NextResponse.json({ error: "The direct Google Ads connection isn't set up yet." }, { status: 400 });
  const { action, value } = await req.json().catch(() => ({}));
  try {
    const db = await getPrisma();
    if (action === "sync") return NextResponse.json({ ok: true, ...(await syncFromApi(db)) });
    let detail: unknown;
    if (action === "block_search") detail = { campaigns: await blockSearch(db, String(value || "")) };
    else if (action === "pause_keyword") { await pauseKeyword(db, String(value || "")); detail = { paused: value }; }
    else return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    await writeAudit(db, {
      entityType: "google-ads", entityId: "6099368375", action: `ads:${action}`, changedFields: [action],
      previousValue: {}, newValue: { value, ...(detail as object) }, changedBy: gate.admin.email,
    });
    return NextResponse.json({ ok: true, ...(detail as object) });
  } catch (e: any) {
    console.error("admin ads", e);
    return NextResponse.json({ error: e?.message || "Google Ads request failed" }, { status: 502 });
  }
}
