import { randomBytes } from "node:crypto";
import { sendEmail, emailConfigured } from "@/lib/notify";
import { poaNamesFromDb } from "@/lib/poa";
import { hidesPrice } from "@/lib/select";
import { SITE } from "@/lib/seo";

/**
 * "Email me if the price drops". A shopper leaves an email on a product page;
 * the daily run (after the morning price updates) emails them once when the
 * price is lower than when they signed up, then deletes the alert. No AI, no
 * marketing list: one email per alert, and a link in it to stop.
 */
const DAY = 86_400_000;
export const ALERT_KEEP_DAYS = 180;
export const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,200}\.[A-Za-z]{2,24}$/;

/** A real drop: at least £1 and 1% below the price they saw. */
export const dropped = (was: number, now: number | null) => now !== null && now > 0 && now <= was - Math.max(1, was * 0.01);

export const newToken = () => randomBytes(18).toString("base64url");

export function alertEmail(p: { title: string; productCode: string; slug: string }, was: number, now: number, token: string, phone: string) {
  const base = SITE().replace(/\/+$/, "");
  const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  return {
    subject: `Price drop: ${p.productCode} is now ${gbp(now)}`,
    text: [
      `Good news: the ${p.title} (${p.productCode}) you asked us to watch has dropped from ${gbp(was)} to ${gbp(now)}.`,
      "",
      `See it: ${base}/products/${p.slug}`,
      `Call us to check stock and book delivery: ${phone}`,
      "",
      "Prices can change daily, so please call to confirm before you visit.",
      "This was a one-off alert and we've now deleted your email address for it.",
      `Didn't ask for this? Ignore it, or stop it here: ${base}/api/price-alert?stop=${token}`,
      "",
      "Euronics Jyotsna Electrical, South Ruislip",
    ].join("\n"),
  };
}

/** Daily: email every shopper whose product got cheaper; delete sent and stale alerts. */
export async function runPriceAlerts(db: any) {
  const stale = await db.priceAlert.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - ALERT_KEEP_DAYS * DAY) } } }).then((r: any) => r.count);
  const waiting: number = await db.priceAlert.count();
  if (!emailConfigured()) return { sent: 0, waiting, note: `${waiting} price alerts waiting; not emailed (no RESEND_API_KEY)` };
  const poa = await poaNamesFromDb(db);
  const alerts: any[] = await db.priceAlert.findMany({
    include: { product: { select: { title: true, productCode: true, slug: true, brand: true, category: true, subcategory: true, pricewire: true, priceNow: true, isVisible: true } } },
  });
  const b = await db.businessInfo.findFirst({ select: { phone: true } }).catch(() => null);
  let sent = 0, failed = 0;
  for (const a of alerts) {
    const p = a.product;
    if (!p?.isVisible || hidesPrice(poa, p) || !dropped(a.priceAtSignup, p.priceNow)) continue;
    const m = alertEmail(p, a.priceAtSignup, p.priceNow, a.token, b?.phone || "020 8864 5763");
    const r = await sendEmail(a.email, m.subject, m.text);
    if (r.sent) { sent++; await db.priceAlert.delete({ where: { id: a.id } }); } else failed++;
  }
  return { sent, waiting: waiting - sent, note: `${sent} price-drop emails sent${failed ? `, ${failed} failed` : ""}; ${waiting - sent} alerts waiting${stale ? `; ${stale} older than ${ALERT_KEEP_DAYS} days removed` : ""}` };
}
