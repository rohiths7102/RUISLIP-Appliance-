import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { testSite } from "@/lib/price-watch/pricewire";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * "Test this site": read one model from a site now, before saving it, and
 * show what came back. Nothing is stored. Body: { kind, url, code }
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 20, bucket: "pricewire-test" });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const code = String(body?.code || "").trim().toUpperCase();
  const url = String(body?.url || "").trim();
  if (!code) return NextResponse.json({ error: "Type a model number to test with." }, { status: 400 });
  if (!/^https:\/\//i.test(url)) return NextResponse.json({ error: "The address must start with https://" }, { status: 400 });
  try {
    const r = await testSite({ kind: body?.kind === "list" ? "list" : "page", url }, code);
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: `Could not read the site: ${String(e?.message || e).slice(0, 160)}` }, { status: 502 });
  }
}
