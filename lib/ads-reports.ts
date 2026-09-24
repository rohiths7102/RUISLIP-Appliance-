/**
 * The Google Ads reports the admin shows, defined once. Two routes feed them,
 * with the same GAQL and the same row shape (AdsApp.search and the REST API
 * both return camelCase JSON):
 *   - the nightly Google Ads Script (lib/ads-sync-script.ts) → /api/ads-sync
 *   - the direct API connection (lib/google-ads-api.ts), once a developer token exists
 * Rows are shaped here and stored as one AdsSnapshot per report.
 */
const M = "metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions";
const LAST30 = "segments.date DURING LAST_30_DAYS";

export const ADS_REPORTS: Record<string, string> = {
  searchTerms: `SELECT search_term_view.search_term, campaign.id, ${M} FROM search_term_view WHERE ${LAST30}`,
  keywords: `SELECT ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.quality_info.quality_score, ${M} FROM keyword_view WHERE ${LAST30} AND ad_group_criterion.status != 'REMOVED' AND campaign.status = 'ENABLED'`,
  ads: `SELECT ad_group.name, ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad_strength, ad_group_ad.ad.final_urls, ${M} FROM ad_group_ad WHERE ${LAST30} AND ad_group_ad.status != 'REMOVED' AND campaign.status = 'ENABLED'`,
  devices: `SELECT segments.device, ${M} FROM campaign WHERE ${LAST30}`,
  weekdays: `SELECT segments.day_of_week, ${M} FROM campaign WHERE ${LAST30}`,
  hours: `SELECT segments.hour, ${M} FROM campaign WHERE ${LAST30}`,
  postcodes: `SELECT campaign.id, segments.geo_target_postal_code, ${M} FROM user_location_view WHERE ${LAST30}`,
  conversionActions: `SELECT segments.conversion_action_name, metrics.all_conversions FROM campaign WHERE ${LAST30}`,
  // What the account already refuses to show ads for — campaign negatives and
  // negative keyword lists — so the admin never offers to block them again.
  negatives: "SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD' AND campaign.status = 'ENABLED'",
  sharedNegatives: "SELECT shared_criterion.keyword.text, shared_criterion.keyword.match_type FROM shared_criterion WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED'",
};

/** Daily per-campaign numbers — the AdsCampaignDay table. */
export const CAMPAIGN_DAYS_QUERY = `SELECT segments.date, campaign.id, campaign.name, campaign.status, ${M} FROM campaign WHERE ${LAST30}`;

export type ReportRow = {
  label: string;            // what the row is about: the search, keyword, device…
  detail?: string;          // secondary text: match type, ad group, landing page…
  key?: string;             // id an action needs ("adGroupId~criterionId" for a keyword)
  status?: string;
  quality?: number | null;
  clicks: number; impressions: number; cost: number; conversions: number;
};

const n = (v: unknown) => Number(v) || 0;
const metrics = (r: any) => ({
  clicks: n(r.metrics?.clicks), impressions: n(r.metrics?.impressions),
  cost: n(r.metrics?.costMicros) / 1e6, conversions: n(r.metrics?.conversions),
});
const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

/** Raw API rows → admin rows, summed per label (a search term spans ad groups). */
export function shapeReport(report: string, raw: any[], geoNames: Record<string, string> = {}): ReportRow[] {
  const pick = (r: any): Omit<ReportRow, keyof ReturnType<typeof metrics>> | null => {
    switch (report) {
      case "searchTerms": return { label: String(r.searchTermView?.searchTerm ?? "") };
      case "keywords": return {
        label: String(r.adGroupCriterion?.keyword?.text ?? ""),
        detail: `${String(r.adGroupCriterion?.keyword?.matchType ?? "").toLowerCase()} · ${r.adGroup?.name ?? ""}`,
        key: `${r.adGroup?.id}~${r.adGroupCriterion?.criterionId}`,
        status: r.adGroupCriterion?.status, quality: r.adGroupCriterion?.qualityInfo?.qualityScore ?? null,
      };
      case "ads": return {
        label: `${r.adGroup?.name ?? ""} ad ${r.adGroupAd?.ad?.id ?? ""}`,
        detail: (r.adGroupAd?.ad?.finalUrls || [])[0] || "", status: r.adGroupAd?.status,
        key: String(r.adGroupAd?.adStrength ?? ""),
      };
      case "devices": return { label: String(r.segments?.device ?? "").toLowerCase() };
      case "weekdays": return { label: String(r.segments?.dayOfWeek ?? "") };
      case "hours": return { label: String(r.segments?.hour ?? "") };
      case "postcodes": {
        const id = String(r.segments?.geoTargetPostalCode ?? "").split("/").pop() || "";
        return { label: geoNames[id] || id, key: id };
      }
      case "conversionActions": return { label: String(r.segments?.conversionActionName ?? "") };
      case "negatives": return { label: String(r.campaignCriterion?.keyword?.text ?? "").toLowerCase(), detail: String(r.campaignCriterion?.keyword?.matchType ?? "") };
      case "sharedNegatives": return { label: String(r.sharedCriterion?.keyword?.text ?? "").toLowerCase(), detail: String(r.sharedCriterion?.keyword?.matchType ?? "") };
      default: return null;
    }
  };
  const byLabel = new Map<string, ReportRow>();
  for (const r of raw) {
    const p = pick(r);
    if (!p || !p.label) continue;
    const m = report === "conversionActions"
      ? { clicks: 0, impressions: 0, cost: 0, conversions: n(r.metrics?.allConversions) }
      : metrics(r);
    const id = p.key && report !== "ads" ? `${p.label}|${p.key}` : `${p.label}|${p.detail ?? ""}`;
    const cur = byLabel.get(id);
    if (cur) { cur.clicks += m.clicks; cur.impressions += m.impressions; cur.cost += m.cost; cur.conversions += m.conversions; }
    else byLabel.set(id, { ...p, ...m });
  }
  const rows = [...byLabel.values()];
  if (report === "weekdays") return rows.sort((a, b) => DAYS.indexOf(a.label) - DAYS.indexOf(b.label));
  if (report === "hours") return rows.sort((a, b) => Number(a.label) - Number(b.label));
  return rows.sort((a, b) => b.cost - a.cost || b.conversions - a.conversions);
}

/**
 * Would this search be stopped by one of the account's negatives? Google's
 * rules: EXACT = the same words; PHRASE = the words in that order, anywhere;
 * BROAD = all the words, any order. (Negatives never match close variants.)
 */
export function isNegated(search: string, negatives: { label: string; detail?: string }[]): boolean {
  const words = search.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const joined = ` ${words.join(" ")} `;
  return negatives.some((n) => {
    const nw = n.label.replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
    if (!nw.length) return false;
    if (n.detail === "EXACT") return nw.join(" ") === words.join(" ");
    if (n.detail === "PHRASE") return joined.includes(` ${nw.join(" ")} `);
    return nw.every((w) => words.includes(w));
  });
}

/** Postcode rows carry geo constant ids; this query names them. */
export const geoNamesQuery = (ids: string[]) =>
  `SELECT geo_target_constant.id, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.id IN (${ids.filter((i) => /^\d+$/.test(i)).join(",")})`;
export const geoIdsOf = (raw: any[]) =>
  [...new Set(raw.map((r) => String(r.segments?.geoTargetPostalCode ?? "").split("/").pop() || "").filter((i) => /^\d+$/.test(i)))];

/** The owner's delivery zone (matches components/PostcodeCheck, the site copy and the campaign's targeting). */
export function inDeliveryZone(district: string): boolean {
  const m = district.toUpperCase().match(/^([A-Z]{1,2})(\d{1,2})$/);
  if (!m) return false;
  const [, area, d] = m, num = Number(d);
  if (area === "HA" || area === "UB") return true;
  if (area === "W") return num >= 3 && num <= 6;
  if (area === "WD") return num >= 3 && num <= 24;
  if (area === "SL") return num === 3 || num === 9;
  return false;
}
