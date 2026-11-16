import { NextResponse } from "next/server";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getPrisma } from "@/lib/prisma";
import { notifyEnquiry } from "@/lib/notify";
import { sendWhatsApp } from "@/lib/whatsapp";
import { rateLimit, clientIp, tooMany } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";

/**
 * Customer enquiries. The database is optional on this site — it runs off the
 * bundled catalogue JSON — so if Prisma isn't available we still capture the
 * enquiry to data/enquiries.jsonl rather than losing a lead. Losing a customer's
 * message on a phone-first shop site is the worst possible failure here.
 *
 * NOTE: the file fallback assumes a persistent disk. On a serverless host, wire
 * an email provider (Resend/SendGrid) or a hosted DB instead.
 */
const FALLBACK = join(process.cwd(), "data", "enquiries.jsonl");

export async function POST(req: Request) {
  const gate = rateLimit("enquiry", clientIp(req), 5, 60_000); // 5 / minute
  if (!gate.ok) return tooMany(gate.retryAfter, "You've sent a few enquiries — please call the store, or try again shortly.");

  const b = await req.json().catch(() => ({}));
  if (!b.name || !b.message) return NextResponse.json({ error: "Name and message are required" }, { status: 400 });
  if (b.company) return NextResponse.json({ ok: true }); // honeypot: bots fill hidden fields
  const chat = b.source === "chat"; // "Call me back" from the chat assistant: the phone number is the point
  if (chat && String(b.phone || "").replace(/\D/g, "").length < 10) return NextResponse.json({ error: "Please give a phone number we can call." }, { status: 400 });

  const record = {
    name: String(b.name).slice(0, 200),
    email: String(b.email || "").slice(0, 200),
    phone: String(b.phone || "").slice(0, 60),
    message: String(b.message).slice(0, 4000),
    productCode: String(b.productCode || "").slice(0, 60),
    productTitle: String(b.productTitle || "").slice(0, 300),
    source: chat ? "chat" : b.productCode ? "product" : "contact",
    gclid: /^[A-Za-z0-9_-]{10,200}$/.test(String(b.gclid || "")) ? String(b.gclid) : "",
    adSource: /^[a-z0-9][a-z0-9._-]{0,39}$/.test(String(b.adSource || "")) ? String(b.adSource) : "",
  };

  try {
    const db = await getPrisma();
    const e = await db.enquiry.create({ data: record });
    await notifyEnquiry(record).catch(() => {}); // alert is best-effort; never blocks the response
    // And to the owner's phone, when WhatsApp is set up (a no-op until then).
    await sendWhatsApp(`New ${record.source} enquiry: ${record.name}, ${record.phone || record.email || "no contact"}${record.productCode ? `, about ${record.productCode}` : ""}. ${record.message.slice(0, 200)}`).catch(() => {});
    return NextResponse.json({ ok: true, id: e.id, stored: "database" });
  } catch {
    // No database configured — persist to disk so the enquiry still reaches the owner.
    try {
      await mkdir(join(process.cwd(), "data"), { recursive: true });
      await appendFile(FALLBACK, JSON.stringify({ ...record, receivedAt: new Date().toISOString() }) + "\n", "utf8");
      await notifyEnquiry(record).catch(() => {}); // alert is best-effort; never blocks the response
      return NextResponse.json({ ok: true, stored: "file" });
    } catch (err) {
      console.error("enquiry: could not store", err);
      return NextResponse.json({ error: "Could not save enquiry. Please call the store." }, { status: 500 });
    }
  }
}
