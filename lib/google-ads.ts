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

/** Tell Google Ads a visitor called or enquired. Before "Accept" (or after "No thanks") consent mode sends it as a cookieless ping Google models from. */
export function reportAdsConversion(kind: keyof typeof SEND_TO) {
  const gtag = (window as any).gtag;
  if (typeof gtag === "function") gtag("event", "conversion", { send_to: SEND_TO[kind] });
}
