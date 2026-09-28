import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getPrisma } from "@/lib/prisma";
import { parsePriceList } from "@/lib/price-list";
import { autoApplySource } from "@/lib/price-watch/auto-apply";
import { revalidateStorefront } from "@/lib/revalidate";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/price-ingest/price-list-email
 *
 * The CIH / Euronics member price list, arriving by email with no one uploading
 * it (owner's request, 28 Sept 2026). An inbound-email service (Postmark
 * inbound, or anything that can POST) sends the email here: Postmark's JSON
 * ({ Subject, Attachments: [{ Name, Content: base64 }] }) or a multipart form
 * with a "file" field.
 *
 * It reads the attachment with the same parser as Admin → Price watch's upload,
 * records each price as an observation under the "cih" source, then hands that
 * source to the same auto-apply engine the nightly Euronics sync uses — which
 * changes prices only if the owner has switched CIH to Automatic in Price watch,
 * and even then holds big moves and never touches a price he locked. Otherwise
 * the prices wait in Price watch for him to apply.
 *
 * Auth: PRICE_LIST_INBOUND_SECRET (24+ chars) as the password of HTTP Basic auth
 * (Postmark puts it in the webhook URL: https://any:SECRET@host/…) or as the
 * x-inbound-secret header.
 */
function authorised(req: Request): boolean {
  const secret = process.env.PRICE_LIST_INBOUND_SECRET || "";
  if (secret.length < 24) return false;
  const basic = (req.headers.get("authorization") || "").match(/^Basic (.+)$/i);
  const given = basic ? Buffer.from(basic[1], "base64").toString().split(":").slice(1).join(":") : req.headers.get("x-inbound-secret") || "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The price list attachment: from Postmark's JSON or a plain multipart upload.
  let file: { name: string; bytes: Uint8Array } | null = null;
  let subject = "";
  if ((req.headers.get("content-type") || "").includes("application/json")) {
    const j: any = await req.json().catch(() => null);
    subject = String(j?.Subject || "");
    const att = (j?.Attachments || []).find((a: any) => /\.(xlsx|csv)$/i.test(String(a?.Name || "")));
    if (att) file = { name: String(att.Name), bytes: new Uint8Array(Buffer.from(String(att.Content || ""), "base64")) };
  } else {
    const f = (await req.formData().catch(() => null))?.get("file");
    if (f instanceof File) file = { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
  }
  // Not every email is a price list; say so without failing the sender's retry loop.
  if (!file) return NextResponse.json({ ok: true, skipped: "no .xlsx or .csv attachment", subject });

  let rows;
  try { rows = parsePriceList(file.name, file.bytes); }
  catch (e) { return NextResponse.json({ ok: true, skipped: (e as Error).message, file: file.name }); }

  const db = await getPrisma();
  // productCode isn't unique (Bosch/Neff twins): a code matching two products is skipped, never guessed.
  const products: { id: string; productCode: string }[] = await db.product.findMany({ select: { id: true, productCode: true } });
  const byCode = new Map<string, string[]>();
  for (const p of products) { const k = norm(p.productCode); byCode.set(k, [...(byCode.get(k) || []), p.id]); }

  const now = new Date();
  const obs = rows.filter((r) => r.price !== null).flatMap((r) => {
    const ids = byCode.get(norm(r.model)) || [];
    return ids.length === 1 ? [{
      productId: ids[0], sourceId: "cih", price: r.price, deliveryCost: 0, inStock: null, includesVat: true, sourceUrl: "",
      matchConfidence: 1, status: "ok", note: `CIH price list by email: ${file!.name}`, observedAt: now,
    }] : [];
  });
  for (let i = 0; i < obs.length; i += 500) await db.priceObservation.createMany({ data: obs.slice(i, i + 500) });

  const auto = await autoApplySource(db, { sourceId: "cih", appliedBy: "price-agent (CIH price list email)" });
  const status = `${obs.length} observed from ${file.name}` + (auto.halted ? ` · waiting in Price watch (${auto.haltReason})` : ` · auto: ${auto.applied.length} applied, ${auto.unchanged} unchanged`);
  await db.priceSource.update({ where: { id: "cih" }, data: { lastRunAt: now, lastRunStatus: status.slice(0, 190) } });
  if (auto.applied.length) revalidateStorefront([], { allPages: true });

  return NextResponse.json({ ok: true, file: file.name, rows: rows.length, observed: obs.length, applied: auto.applied.length, halted: auto.halted ? auto.haltReason : null });
}
