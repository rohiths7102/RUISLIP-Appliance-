import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
export const dynamic = "force-dynamic";

/**
 * The owner's switch on the price agent. `allowAutoApply` is what separates
 * "the system watches" from "the system acts" — so flipping it is a session-
 * authenticated human action, audit-logged, and never reachable by the machine
 * keys (which are the thing the switch governs).
 *
 * Only `authorised` sources may ever have auto-apply turned on: an advisory
 * source is someone else's retail price and the guards would block it row by
 * row anyway, but refusing here keeps the admin UI honest about what the
 * toggle can do.
 */
export async function PATCH(req: Request) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "Missing source id" }, { status: 400 });

  try {
    const db = await getPrisma();
    const existing = await db.priceSource.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "No such price source" }, { status: 404 });

    const data: Record<string, boolean> = {};
    if (typeof body.allowAutoApply === "boolean") {
      if (body.allowAutoApply && existing.kind !== "authorised") {
        return NextResponse.json(
          { error: "Only an authorised source (your own supplier or buying group) can apply prices automatically." },
          { status: 400 },
        );
      }
      data.allowAutoApply = body.allowAutoApply;
    }
    if (typeof body.enabled === "boolean") data.enabled = body.enabled;
    if (!Object.keys(data).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

    const updated = await db.priceSource.update({ where: { id }, data });
    await writeAudit(db, {
      entityType: "price-source",
      entityId: id,
      action: "price-watch:source-toggle",
      changedFields: Object.keys(data),
      previousValue: { allowAutoApply: existing.allowAutoApply, enabled: existing.enabled },
      newValue: { allowAutoApply: updated.allowAutoApply, enabled: updated.enabled },
      changedBy: admin.email,
    });
    return NextResponse.json({
      id: updated.id,
      enabled: updated.enabled,
      allowAutoApply: updated.allowAutoApply,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
