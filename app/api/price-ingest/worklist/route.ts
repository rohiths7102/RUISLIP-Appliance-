import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { verifyMachineRequest, readRawBody } from "@/lib/machine-auth";
import { worklistProducts } from "@/lib/price-watch/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/price-ingest/worklist?source=<sourceId>&limit=<n>
 *
 * What a collector asks for at the start of a run: "which products should I go
 * and look up for this source, and what do we currently charge?". Read-only.
 *
 * NOT behind the admin middleware gate (that is an IP allowlist, and a
 * scheduled worker has no fixed IP) — it authenticates per request with the
 * HMAC scheme in lib/machine-auth.ts. A GET has an empty body, so the signature
 * is over `${timestamp}.` — the empty string is still signed, which keeps one
 * signing implementation for every route. The query string is NOT signed, so
 * treat source/limit as untrusted input and validate them here.
 */
export async function GET(req: Request) {
  const rawBody = await readRawBody(req); // "" for GET, but still the signed payload
  const auth = verifyMachineRequest(req, rawBody, "worklist");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const sourceId = (url.searchParams.get("source") || "").trim();
  if (!sourceId) return NextResponse.json({ error: "Missing ?source" }, { status: 400 });

  const limitRaw = Number(url.searchParams.get("limit") ?? 100);
  // Clamp rather than reject: a worker asking for 10_000 should get a sane page,
  // not a failed run. 3,000 covers every Euronics-carried line (~2,700), so each
  // price is re-checked every night; at 500 a line waited ~6 nights, long enough
  // to miss a promo ending (WF3S1043BW3 sat at £320 after Euronics went back to
  // £349). The collector posts observations back in 500-row chunks.
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 4000) : 100;

  try {
    const db = await getPrisma();
    const source = await db.priceSource.findUnique({ where: { id: sourceId } });
    if (!source || !source.enabled) {
      return NextResponse.json({ error: "Unknown or disabled source" }, { status: 404 });
    }

    const items = await worklistProducts(db, { sourceId, limit });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
