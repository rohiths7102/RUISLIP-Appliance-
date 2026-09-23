import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { encrypt, exchangeCode, emailFromIdToken, forgetAccessToken } from "@/lib/google-oauth";
import { adminHref } from "@/lib/admin-config";
export const dynamic = "force-dynamic";

/** Google sends the owner back here after consent; the refresh token is stored encrypted. */
export async function GET(req: Request) {
  const admin = await getAdmin();
  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(`${adminHref("ads")}?google=${status}`, req.url));
    res.cookies.delete("g_oauth_state");
    return res;
  };
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const state = (await cookies()).get("g_oauth_state")?.value;
  if (!state || state !== url.searchParams.get("state")) return back("bad-state");
  if (url.searchParams.get("error")) return back("declined");

  try {
    const t = await exchangeCode(url.searchParams.get("code") || "");
    // Google only returns a refresh token with prompt=consent; without one the connection can't last.
    if (!t.refresh_token) return back("no-refresh-token");
    const db = await getPrisma();
    const data = { email: emailFromIdToken(t.id_token), scopes: t.scope, refreshToken: encrypt(t.refresh_token), connectedBy: admin.email };
    await db.googleConnection.upsert({ where: { id: "google" }, create: { id: "google", ...data }, update: data });
    forgetAccessToken();
    await writeAudit(db, {
      entityType: "google", entityId: "google", action: "google:connect", changedFields: ["googleConnection"],
      previousValue: {}, newValue: { email: data.email, scopes: data.scopes }, changedBy: admin.email,
    });
    return back("connected");
  } catch (e) {
    console.error("google callback", e);
    return back("failed");
  }
}
