import { NextResponse } from "next/server";
import { checkCredentials, createToken, COOKIE_NAME } from "@/lib/auth";
import { rateLimit, clientIp, tooMany } from "@/lib/rate-limit";
import { safeCallback } from "@/lib/admin-config";
export const dynamic = "force-dynamic";

// Brute-force guard: scrypt already makes each guess slow, but nothing stopped a
// bot from trying forever. Two windows: a burst limit and a slower long window,
// so a wrong-password human is never blocked but a script is.
const BURST = { limit: 8, windowMs: 60_000 };       // 8 / minute
const SUSTAINED = { limit: 30, windowMs: 15 * 60_000 }; // 30 / 15 min

export async function POST(req: Request) {
  const ip = clientIp(req);
  const b = rateLimit("login-burst", ip, BURST.limit, BURST.windowMs);
  if (!b.ok) return tooMany(b.retryAfter, "Too many sign-in attempts. Please wait a minute and try again.");
  const s = rateLimit("login-sustained", ip, SUSTAINED.limit, SUSTAINED.windowMs);
  if (!s.ok) return tooMany(s.retryAfter, "Too many sign-in attempts. Please try again later.");

  const { email, password, callbackUrl } = await req.json().catch(() => ({}));
  if (!email || !password || !checkCredentials(email, password)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Never trust the client's callbackUrl blindly — must be a same-origin path.
  const res = NextResponse.json({ ok: true, redirect: safeCallback(callbackUrl) });
  res.cookies.set(COOKIE_NAME, createToken(email), {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 86400,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
