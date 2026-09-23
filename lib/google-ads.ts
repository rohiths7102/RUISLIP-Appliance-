/**
 * Google Ads account 609-936-8375 (Ruislip Euronics). These IDs are public —
 * they appear in the page source of every site running an Ads tag.
 * The conversion actions were created 23 Sept 2026 ("Website call tap",
 * "Website enquiry"); the campaign bids on them.
 */
export const GOOGLE_ADS_ID = "AW-1001930860";
const SEND_TO = {
  call: `${GOOGLE_ADS_ID}/ZN6ECNv-xIIdEOyA4d0D`,
  enquiry: `${GOOGLE_ADS_ID}/DwasCN7-xIIdEOyA4d0D`,
};

/** Tell Google Ads a visitor called or enquired. A no-op unless they accepted cookies (gtag only exists then). */
export function reportAdsConversion(kind: keyof typeof SEND_TO) {
  const gtag = (window as any).gtag;
  if (typeof gtag === "function") gtag("event", "conversion", { send_to: SEND_TO[kind] });
}
