import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { liveSnapshot } from "@/lib/marketing/live";
import { searchFresh } from "@/lib/search-console";
export const dynamic = "force-dynamic";

// Google's hourly figures move once an hour at most; the page polls every 15s.
let google: { at: number; data: any } | null = null;

async function googleFresh(db: any) {
  if (google && Date.now() - google.at < 5 * 60_000) return google.data;
  let data: any;
  try {
    const [hours, queries] = await Promise.all([searchFresh(db, "hour"), searchFresh(db, "query")]);
    data = hours === null ? { connected: false } : { connected: true, hours, queries };
  } catch (e: any) {
    data = { connected: true, error: String(e?.message || e).slice(0, 200) };
  }
  google = { at: Date.now(), data };
  return data;
}

/** Admin → Live polls this. */
export async function GET() {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = await getPrisma();
    const [site, g] = await Promise.all([liveSnapshot(db), googleFresh(db)]);
    return NextResponse.json({ ...site, google: g }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("admin live", e);
    return NextResponse.json({ error: "Live data unavailable" }, { status: 500 });
  }
}
