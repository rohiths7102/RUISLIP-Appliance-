import { accessToken } from "@/lib/google-oauth";

/**
 * Google Search Console over the same "Connect Google" sign-in: what people
 * searched when the site showed up in Google's free results. GSC_SITE is the
 * property as Search Console names it (a Domain property by default).
 */
const SITE = process.env.GSC_SITE || "sc-domain:kitchen-appliances.co.uk";

export type GscRow = { key: string; clicks: number; impressions: number; ctr: number; position: number };

export async function searchAnalytics(db: any, dimension: "query" | "page", days = 28): Promise<GscRow[] | null> {
  const token = await accessToken(db);
  if (!token) return null;
  const end = new Date(Date.now() - 2 * 86_400_000); // GSC data lags ~2 days
  const start = new Date(end.getTime() - days * 86_400_000);
  const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), dimensions: [dimension], rowLimit: 250 }),
    signal: AbortSignal.timeout(20000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Search Console: ${j?.error?.message || r.status}`);
  return (j.rows || []).map((x: any) => ({ key: x.keys[0], clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position }));
}
