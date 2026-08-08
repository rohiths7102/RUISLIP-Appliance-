import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
export const dynamic = "force-dynamic";

const pick = (o: any, ks: string[]) => Object.fromEntries(ks.map((k) => [k, o?.[k]]));

export async function GET() {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getPrisma();
  return NextResponse.json(await db.enquiry.findMany({ orderBy: { createdAt: "desc" } }));
}

/** Pipeline stages. "closed" is the legacy value — kept readable, mapped to won in the UI. */
const STATUSES = ["new", "contacted", "quoted", "won", "lost", "closed"];

export async function PATCH(req: Request) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const existing = await db.enquiry.findUnique({ where: { id: b.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // What was quoted, and when it was said, has to be reconstructable if a customer
  // disputes it months later — so a real change is never written without a log row.
  const changed = Object.keys(data).filter((k) => !Object.is(data[k], existing[k]));
  if (!changed.length) return NextResponse.json(existing);

  const updated = await db.enquiry.update({ where: { id: b.id }, data });
  await writeAudit(db, {
    entityType: "enquiry", entityId: b.id, action: "update", changedFields: changed,
    previousValue: pick(existing, changed), newValue: pick(updated, changed), changedBy: admin.email,
  });
  return NextResponse.json(updated);
}
