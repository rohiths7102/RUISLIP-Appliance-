import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";

/**
 * First-party analytics beacon. Records two things the owner asked for:
 *   call_click      — someone pressed a "Call" button (with the page / product)
 *   postcode_check  — someone entered their postcode in the prompt
 *
 * Deliberately anonymous: no cookies, no IP stored, no user agent. Analytics
 * must NEVER break the customer experience, so every path out of here is a
 * quiet 204 — including when the database is down.
 */
const TYPES = new Set(["call_click", "postcode_check"]);

export async function POST(req: Request) {
  // Analytics never surfaces errors — over-limit is a silent 204, not a 429.
  if (!rateLimit("track", clientIp(req), 60, 60_000).ok) return new NextResponse(null, { status: 204 });

  const b = await req.json().catch(() => null);
  if (!b || !TYPES.has(b.type)) return new NextResponse(null, { status: 204 });

  try {
    const db = await getPrisma();
    await db.trackedEvent.create({
      data: {
        type: b.type,
        path: String(b.path || "").slice(0, 200),
        productSlug: String(b.productSlug || "").slice(0, 120),
        postcode: String(b.postcode || "").toUpperCase().slice(0, 10),
        isLocal: typeof b.isLocal === "boolean" ? b.isLocal : null,
      },
    });
  } catch { /* analytics never surfaces errors */ }
  return new NextResponse(null, { status: 204 });
}
