import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getPrisma();
  return NextResponse.json(await db.enquiry.findMany({ orderBy: { createdAt: "desc" } }));
}

/** Pipeline stages. "closed" is the legacy value — kept readable, mapped to won in the UI. */
const STATUSES = ["new", "contacted", "quoted", "won", "lost", "closed"];

export async function PATCH(req: Request) {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return NextResponse.json({ error: "Bad status" }, { status: 400 });
    data.status = b.status;
  }
  if (b.notes !== undefined) data.notes = String(b.notes).slice(0, 4000);
  if (b.quotedPrice !== undefined) {
    if (b.quotedPrice === null || b.quotedPrice === "") data.quotedPrice = null;
    else {
      const n = Number(b.quotedPrice);
      if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: "Quoted price must be a number" }, { status: 400 });
      data.quotedPrice = n;
    }
  }
  // The mailto/copy path can't observe the send, so the UI reports it explicitly.
  if (b.markEmailed) {
    data.lastEmailedAt = new Date();
  }
  if (b.aiDraftSubject !== undefined) data.aiDraftSubject = String(b.aiDraftSubject).slice(0, 300);
  if (b.aiDraftBody !== undefined) data.aiDraftBody = String(b.aiDraftBody).slice(0, 8000);
  if (!Object.keys(data).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const db = await getPrisma();
  return NextResponse.json(await db.enquiry.update({ where: { id: b.id }, data }));
}
