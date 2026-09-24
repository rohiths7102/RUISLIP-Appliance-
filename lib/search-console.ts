import { accessToken } from "@/lib/google-oauth";
import { SITE } from "@/lib/seo";

/**
 * Google Search Console over the same "Connect Google" sign-in: what people
 * searched when the site showed up in Google's free results.
 *
 * Which property: GSC_SITE when set, else whichever of the shop's properties the
 * connected account can actually see — the Domain property if it has one, else
 * the https://www URL-prefix one (verified with the HTML file, 24 Sept 2026).
 * Hard-coding the Domain property failed with "User does not have sufficient
 * permission" for an account that could only see the URL-prefix one.
 */
const HOST = () => new URL(SITE()).hostname.replace(/^www\./, "");

/** The connected account sees none of the shop's properties: say who, and what it does see. */
export class NoSearchConsoleAccess extends Error {
  constructor(readonly who: string, readonly sees: string[]) {
    super(`Search Console: ${who} can't see ${HOST()} in Search Console${sees.length ? ` (it can see ${sees.join(", ")})` : ""}.`);
  }
}

// Keyed on the access token, so reconnecting a different Google account looks again.
let found: { token: string; site: string } | null = null;

/** The property to query, or null when Google isn't connected. Throws NoSearchConsoleAccess when the account can't see the site. */
export async function searchConsoleSite(db: any, token?: string | null): Promise<string | null> {
  if (process.env.GSC_SITE) return process.env.GSC_SITE;
  const t = token === undefined ? await accessToken(db) : token;
  if (!t) return null;
  if (found?.token === t) return found.site;
  const r = await fetch("https://www.googleapis.com/webmasters/v3/sites", { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Search Console: ${j?.error?.message || r.status}`);
  const sees: string[] = (j.siteEntry || []).filter((s: any) => s.permissionLevel !== "siteUnverifiedUser").map((s: any) => s.siteUrl);
  const h = HOST();
  const site = [`sc-domain:${h}`, `https://www.${h}/`, `https://${h}/`, `http://www.${h}/`, `http://${h}/`].find((s) => sees.includes(s));
  if (!site) {
    const conn = await db.googleConnection.findUnique({ where: { id: "google" }, select: { email: true } }).catch(() => null);
    throw new NoSearchConsoleAccess(conn?.email || "the connected Google account", sees);
  }
  found = { token: t, site };
  return site;
}

export type GscRow = { key: string; clicks: number; impressions: number; ctr: number; position: number };

export async function searchAnalytics(db: any, dimension: "query" | "page" | "date", days = 28, page?: string): Promise<GscRow[] | null> {
  const token = await accessToken(db);
  if (!token) return null;
  const site = await searchConsoleSite(db, token);
  if (!site) return null;
  const end = new Date(Date.now() - 2 * 86_400_000); // GSC data lags ~2 days
  const start = new Date(end.getTime() - days * 86_400_000);
  const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), dimensions: [dimension], rowLimit: 250,
      // Narrow to one page's searches (the SEO editor's "what people typed to find this page").
      ...(page ? { dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: page }] }] } : {}),
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Search Console: ${j?.error?.message || r.status}`);
  return (j.rows || []).map((x: any) => ({ key: x.keys[0], clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position }));
}
