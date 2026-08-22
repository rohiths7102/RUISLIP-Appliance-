import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { verifyMachineRequest, readRawBody, keyMaySourceWrite } from "@/lib/machine-auth";
import { autoApplySource } from "@/lib/price-watch/auto-apply";
import { revalidateStorefront } from "@/lib/revalidate";
export const dynamic = "force-dynamic";

/**
 * Machine-triggered price application — called by the n8n collector AFTER it
 * has posted observations, so scrape and apply stay two distinct, separately
 * audited steps.
 *
 * The caller cannot make this do anything a human would not be allowed to
 * approve: every row runs the FULL guard set inside autoApplySource, the
 * source itself must be authorised+enabled+allowAutoApply (a switch that only
 * the admin panel can flip), and a run wanting more than the change budget
 * applies NOTHING. A leaked collector key can therefore, at worst, apply the
 * buying group's own mandated prices a night early.
 */
export async function POST(req: Request) {
  const rawBody = await readRawBody(req);
  const auth = verifyMachineRequest(req, rawBody, "auto-apply");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: any;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return NextResponse.json({ error: "Body is not valid JSON" }, { status: 400 });
  }
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId.trim() : "";
  if (!sourceId) return NextResponse.json({ error: "Missing sourceId" }, { status: 400 });
  if (!keyMaySourceWrite(auth.keyId, sourceId)) {
    return NextResponse.json(
      { error: `Key "${auth.keyId}" may not apply prices for source "${sourceId}"` },
      { status: 403 },
    );
  }
  const maxChanges = Number.isFinite(Number(body?.maxChanges)) ? Number(body.maxChanges) : undefined;

  try {
    const db = await getPrisma();
    const outcome = await autoApplySource(db, {
      sourceId,
      maxChanges,
      appliedBy: `price-agent (${auth.keyId})`,
    });
    if (outcome.applied.length) revalidateStorefront(["/", "/products"]);
    return NextResponse.json(outcome);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
