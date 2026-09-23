import { ADS_REPORTS, CAMPAIGN_DAYS_QUERY } from "@/lib/ads-reports";

/**
 * The Google Ads Script that feeds /api/ads-sync. Admin → Google Ads shows it
 * with the endpoint and secret filled in; the owner pastes it into Google Ads →
 * Tools → Bulk actions → Scripts and schedules it daily. It sends the last 30
 * days each night (Google's late conversion updates overwrite older rows),
 * running the same queries as the direct API connection (lib/ads-reports.ts).
 */
export function adsSyncScript(endpoint: string, secret: string): string {
  return `// Jyotsna Electrical website sync: Google Ads -> Admin > Google Ads. Schedule: Daily.
var ENDPOINT = ${JSON.stringify(endpoint)};
var SECRET = ${JSON.stringify(secret)};
var DAYS_QUERY = ${JSON.stringify(CAMPAIGN_DAYS_QUERY)};
var REPORTS = ${JSON.stringify(ADS_REPORTS, null, 2)};

function rows(query) {
  var out = [], it = AdsApp.search(query);
  while (it.hasNext()) out.push(it.next());
  return out;
}

function main() {
  var reports = {};
  for (var name in REPORTS) reports[name] = rows(REPORTS[name]);
  // Postcode rows carry Google's location ids; look their names up once.
  var ids = {};
  reports.postcodes.forEach(function (r) {
    var id = String((r.segments && r.segments.geoTargetPostalCode) || "").split("/").pop();
    if (/^\d+$/.test(id)) ids[id] = true;
  });
  var geoNames = {};
  if (Object.keys(ids).length) {
    rows("SELECT geo_target_constant.id, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.id IN (" + Object.keys(ids).join(",") + ")")
      .forEach(function (g) { geoNames[String(g.geoTargetConstant.id)] = g.geoTargetConstant.name; });
  }
  var res = UrlFetchApp.fetch(ENDPOINT, {
    method: "post",
    contentType: "application/json",
    headers: { "x-ads-sync-secret": SECRET },
    payload: JSON.stringify({ campaignDays: rows(DAYS_QUERY), reports: reports, geoNames: geoNames }),
    muteHttpExceptions: true
  });
  Logger.log(res.getResponseCode() + " " + res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error("Sync failed: " + res.getContentText());
}
`;
}
