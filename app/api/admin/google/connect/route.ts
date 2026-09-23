import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getAdmin } from "@/lib/auth";
import { authUrl, oauthConfigured } from "@/lib/google-oauth";
import { adminHref } from "@/lib/admin-config";
export const dynamic = "force-dynamic";

/** Admin → Google Ads → "Connect Google": off to Google's consent screen. */
export async function GET(req: Request) {
  if (!(await getAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!oauthConfigured()) return NextResponse.redirect(new URL(`${adminHref("ads")}?google=not-configured`, req.url));
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set("g_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
