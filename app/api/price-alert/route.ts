import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { rateLimit, clientIp, tooMany } from "@/lib/rate-limit";
import { poaNamesFromDb } from "@/lib/poa";
import { hidesPrice } from "@/lib/select";
import { EMAIL_RE, newToken } from "@/lib/price-alerts";
export const dynamic = "force-dynamic";

/** POST { slug, email }: watch this product's price for this email (lib/price-alerts.ts). */
export async function POST(req: Request) {
  const gate = rateLimit("price-alert", clientIp(req), 5, 60_000);
  if (!gate.ok) return tooMany(gate.retryAfter, "Too many tries; please try again in a minute.");
  const b = await req.json().catch(() => ({}));
  if (b.company) return NextResponse.json({ ok: true }); // honeypot
  const email = String(b.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  const db = await getPrisma();
  const p = await db.product.findUnique({ where: { slug: String(b.slug || "") }, select: { id: true, brand: true, category: true, subcategory: true, pricewire: true, priceNow: true, isVisible: true } });
  if (!p?.isVisible || p.priceNow === null || hidesPrice(await poaNamesFromDb(db), p)) return NextResponse.json({ error: "This product has no online price to watch; please call us for a quote." }, { status: 400 });
  // Signing up again restarts the watch from today's price.
  await db.priceAlert.upsert({
    where: { productId_email: { productId: p.id, email } },
    create: { productId: p.id, email, priceAtSignup: p.priceNow, token: newToken() },
    update: { priceAtSignup: p.priceNow, createdAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}

/** GET ?stop=<token>: the email's link; deletes the alert. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("stop") || "";
  if (token.length >= 20) {
    const db = await getPrisma();
    await db.priceAlert.deleteMany({ where: { token } }).catch(() => null);
  }
  return new Response("<!doctype html><meta name=viewport content='width=device-width'><title>Price alert stopped</title><body style='font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem'><h1>Price alert stopped</h1><p>We won't email you about this product, and your email address has been deleted from it.</p><p><a href='/'>Back to the shop</a></p>",
    { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
