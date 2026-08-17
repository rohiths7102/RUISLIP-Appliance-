import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { syncBusinessToRag } from "@/lib/rag/index";
import { revalidateStorefront } from "@/lib/revalidate";
export const dynamic = "force-dynamic";
const EDITABLE = ["businessName", "tradingName", "phone", "email", "deliveryRadius", "deliveryNotes", "mapQuery", "googleMapsEmbedUrl", "googleMapsDirectionsUrl", "address", "openingHours", "socialLinks",
  "companyNumber", "placeOfRegistration", "registeredOffice", "vatNumber"];
const pick = (o: any, ks: string[]) => Object.fromEntries(ks.map((k) => [k, o?.[k]]));
export async function PATCH(req: Request) {
  const admin = await getAdmin(); if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const db = await getPrisma();
    const existing = await db.businessInfo.findUnique({ where: { id: "business" } });
    const data: Record<string, any> = {}; const changed: string[] = [];
    for (const k of EDITABLE) if (k in body) { data[k] = body[k]; changed.push(k); }
    const updated = await db.businessInfo.update({ where: { id: "business" }, data });
    await writeAudit(db, { entityType: "business", entityId: "business", action: "update", changedFields: changed, previousValue: pick(existing, changed), newValue: pick(updated, changed), changedBy: admin.email });
    try { await syncBusinessToRag(db); } catch { /* reindex best-effort */ }
    // Business details render on every storefront page (header/contact/about),
    // and the trading disclosures (company number, VAT number, registered
    // office) render in the footer and on /terms and /privacy — those two are
    // hourly-ISR, so without listing them here a saved VAT number would not
    // appear for up to an hour.
    revalidateStorefront(["/about", "/contact", "/delivery-services", "/terms", "/privacy"]);
    return NextResponse.json(updated);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
