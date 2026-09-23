import { ADS_REPORTS, shapeReport } from "@/lib/ads-reports";

/**
 * What either feed (the nightly Ads Script or the direct API) hands over: the
 * raw GAQL rows. Everything is shaped and validated here, in one place.
 */
export type AdsPayload = { campaignDays: any[]; reports: Record<string, any[]>; geoNames?: Record<string, string> };

const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);

export async function saveAdsPayload(db: any, p: AdsPayload): Promise<{ days: number; reports: number }> {
  let days = 0;
  for (const r of Array.isArray(p.campaignDays) ? p.campaignDays.slice(0, 5000) : []) {
    const date = String(r.segments?.date ?? ""), campaignId = String(r.campaign?.id ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,20}$/.test(campaignId)) continue;
    const data = {
      campaignName: String(r.campaign?.name ?? "").slice(0, 200), status: String(r.campaign?.status ?? "").slice(0, 20),
      clicks: Math.round(n(r.metrics?.clicks)), impressions: Math.round(n(r.metrics?.impressions)),
      cost: n(r.metrics?.costMicros) / 1e6, conversions: n(r.metrics?.conversions),
    };
    await db.adsCampaignDay.upsert({ where: { date_campaignId: { date, campaignId } }, create: { date, campaignId, ...data }, update: data });
    days++;
  }
  let reports = 0;
  for (const name of Object.keys(ADS_REPORTS)) {
    const raw = p.reports?.[name];
    if (!Array.isArray(raw)) continue;
    const rows = shapeReport(name, raw.slice(0, 20000), p.geoNames || {}).slice(0, 500);
    await db.adsSnapshot.upsert({ where: { report: name }, create: { report: name, rows }, update: { rows } });
    reports++;
  }
  return { days, reports };
}
