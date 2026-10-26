import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { verifyMachineRequest, readRawBody } from "@/lib/machine-auth";
import { runPricewire } from "@/lib/price-watch/pricewire-run";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * n8n's trigger for Pricewire (ops/n8n/pricewire.json): the Oracle box calls
 * this on its schedule, signed with the collector key, and the site does the
 * reading and applying itself. The caller chooses nothing — not the sites,
 * not the brands, not what is applied; it can only start the same run the
 * 05:00 cron does. Body: {} (a `deadlineMs` under 280000 is honoured).
 */
export async function POST(req: Request) {
  const rawBody = await readRawBody(req);
  const auth = verifyMachineRequest(req, rawBody, "pricewire");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: any = {};
  try { body = JSON.parse(rawBody || "{}"); } catch { return NextResponse.json({ error: "Body is not valid JSON" }, { status: 400 }); }
  const deadlineMs = Math.min(280_000, Math.max(10_000, Number(body?.deadlineMs) || 230_000));
  try {
    const out = await runPricewire(await getPrisma(), { deadlineMs, by: `price-agent (Pricewire via ${auth.keyId})` });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
