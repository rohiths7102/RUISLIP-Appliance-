import { accessToken, oauthConfigured } from "@/lib/google-oauth";
import { ADS_REPORTS, CAMPAIGN_DAYS_QUERY, geoIdsOf, geoNamesQuery } from "@/lib/ads-reports";
import { saveAdsPayload } from "@/lib/ads-store";

/**
 * The direct Google Ads API connection. Live once both exist:
 *   GOOGLE_OAUTH_CLIENT_ID/SECRET (lib/google-oauth.ts), from a Google Cloud
 *     project whose Google Ads API access level is Basic or above — since
 *     9 Sept 2026 that is granted in Google Cloud console
 *     (console.cloud.google.com/google/ads-apis/overview), not by a developer token
 *   the owner's Google sign-in   Admin → Google Ads → Connect Google
 * GOOGLE_ADS_DEVELOPER_TOKEN is only sent if set (Google now ignores it).
 * Optional: GOOGLE_ADS_LOGIN_CUSTOMER_ID only when access is through a manager
 * account (the shop account is accessed directly, so unset); GOOGLE_ADS_API_VERSION
 * when Google retires this version.
 * Until then the nightly Ads Script feeds the same reports.
 */
const CUSTOMER = (process.env.GOOGLE_ADS_CUSTOMER_ID || "6099368375").replace(/-/g, "");
const VERSION = process.env.GOOGLE_ADS_API_VERSION || "v24";
const BASE = `https://googleads.googleapis.com/${VERSION}/customers/${CUSTOMER}`;

export const adsApiConfigured = () => oauthConfigured();

async function call(db: any, path: string, body: unknown): Promise<any> {
  const token = await accessToken(db);
  if (!token || !adsApiConfigured()) throw new Error("Google Ads API is not connected");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`, "Content-Type": "application/json",
  };
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) headers["developer-token"] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers["login-customer-id"] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, "");
  // Customer-level methods are "customers/{id}:method"; resources are ".../{id}/googleAds:…".
  const r = await fetch(path.startsWith(":") ? `${BASE}${path}` : `${BASE}/${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.details?.[0]?.errors?.[0]?.message || j?.error?.message || `HTTP ${r.status}`;
    throw new Error(`Google Ads: ${msg}`);
  }
  return j;
}

export async function search(db: any, query: string): Promise<any[]> {
  const out: any[] = [];
  let pageToken: string | undefined;
  do {
    const j = await call(db, "googleAds:search", { query, ...(pageToken ? { pageToken } : {}) });
    out.push(...(j.results || []));
    pageToken = j.nextPageToken;
  } while (pageToken && out.length < 50000);
  return out;
}

/** Pull every report straight from Google and store it (the same shape the script sends). */
export async function syncFromApi(db: any) {
  const reports: Record<string, any[]> = {};
  for (const [name, q] of Object.entries(ADS_REPORTS)) reports[name] = await search(db, q);
  const ids = geoIdsOf(reports.postcodes || []);
  const geoNames: Record<string, string> = {};
  if (ids.length) for (const g of await search(db, geoNamesQuery(ids))) geoNames[String(g.geoTargetConstant.id)] = g.geoTargetConstant.name;
  return saveAdsPayload(db, { campaignDays: await search(db, CAMPAIGN_DAYS_QUERY), reports, geoNames });
}

/* ---------- the two actions the admin offers ---------- */

/** Stop ads showing for this exact search, in every live Search campaign. */
export async function blockSearch(db: any, term: string): Promise<number> {
  const text = term.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
  if (!text) throw new Error("Nothing to block");
  const camps = await search(db, "SELECT campaign.resource_name FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type = 'SEARCH'");
  if (!camps.length) return 0;
  await call(db, "googleAds:mutate", {
    mutateOperations: camps.map((c) => ({
      campaignCriterionOperation: { create: { campaign: c.campaign.resourceName, negative: true, keyword: { text, matchType: "EXACT" } } },
    })),
  });
  return camps.length;
}

/** Pause one keyword ("adGroupId~criterionId"). Reversible in Google Ads with one click. */
export async function pauseKeyword(db: any, key: string): Promise<void> {
  if (!/^\d+~\d+$/.test(key)) throw new Error("Bad keyword id");
  await call(db, "googleAds:mutate", {
    mutateOperations: [{
      adGroupCriterionOperation: { update: { resourceName: `customers/${CUSTOMER}/adGroupCriteria/${key}`, status: "PAUSED" }, updateMask: "status" },
    }],
  });
}

/* ---------- a won sale, back to Google Ads ---------- */

/** "Website sale" (UPLOAD_CLICKS, secondary), created 23 Sept 2026. */
const SALE_ACTION = `customers/${CUSTOMER}/conversionActions/7790424716`;

/**
 * Report a sale against the ad click that brought the customer, so Google Ads
 * sees which clicks became money, not just calls. Needs the gclid captured at
 * enquiry time (only present if the visitor accepted cookies).
 */
export async function uploadSale(db: any, sale: { gclid: string; value: number; at?: Date }): Promise<void> {
  const at = (sale.at ?? new Date()).toISOString().replace("T", " ").replace(/\.\d+Z$/, "+00:00");
  const j = await call(db, ":uploadClickConversions", {
    conversions: [{ gclid: sale.gclid, conversionAction: SALE_ACTION, conversionDateTime: at, conversionValue: Math.max(0, sale.value), currencyCode: "GBP" }],
    partialFailure: true,
  });
  if (j.partialFailureError) throw new Error(`Google Ads: ${j.partialFailureError.message || "sale not accepted"}`);
}
