import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { sendViaOutlook, graphConfigured } from "@/lib/mailer";
export const dynamic = "force-dynamic";

/**
 * One-click send through the shop's Microsoft 365 (Graph sendMail).
 * Until Entra is connected this answers { reason: "not_connected" } and the UI
 * falls back to the owner's own mail app — no dead button, no silent failure.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const subject = String(b.subject || "").trim();
  const body = String(b.body || "").trim();
  if (!subject || !body) return NextResponse.json({ error: "Subject and body are required" }, { status: 400 });

  try {
    const db = await getPrisma();
    const lead = await db.enquiry.findUnique({ where: { id } });
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    if (!lead.email) return NextResponse.json({ error: "This lead left no email address — call them instead." }, { status: 400 });
    // Belt and braces: a draft with the placeholder still in it must never be sent.
    if (/\[ADD YOUR PRICE\]/i.test(body)) {
      return NextResponse.json({ error: "The draft still contains [ADD YOUR PRICE] — fill in your price first." }, { status: 400 });
    }

    if (!graphConfigured()) return NextResponse.json({ ok: false, reason: "not_connected" });

    const sent = await sendViaOutlook({ to: lead.email, toName: lead.name, subject, body });
    if (!sent.ok) return NextResponse.json({ ok: false, reason: sent.reason }, { status: sent.reason === "not_connected" ? 200 : 502 });

    await db.enquiry.update({
      where: { id },
      data: { lastEmailedAt: new Date(), ...(lead.status === "new" ? { status: "contacted" } : {}) },
    });
    await writeAudit(db, {
      entityType: "enquiry", entityId: id, action: "email-sent",
      changedFields: ["lastEmailedAt"], previousValue: {}, newValue: { to: lead.email, subject },
      changedBy: admin.email,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("lead send", e);
    return NextResponse.json({ error: "Send failed — is the database running?" }, { status: 500 });
  }
}
