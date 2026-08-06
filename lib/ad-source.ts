/**
 * Client-side session attribution. Google Ads auto-tagging appends gclid (or
 * gbraid/wbraid on iOS) to the landing URL; UTM-tagged campaigns carry
 * utm_source/utm_medium. The landing page stamps the session once, and every
 * tracked event after that reports it — so the Ads page can show which calls
 * the owner's spend produced, first-party, no cookies, no third parties.
 */
const KEY = "ka_src";

export function captureAdSource(): void {
  try {
    const sp = new URLSearchParams(location.search);
    if (sp.has("gclid") || sp.has("gbraid") || sp.has("wbraid") ||
        sp.get("utm_medium") === "cpc" || (sp.get("utm_source") || "").toLowerCase() === "google") {
      sessionStorage.setItem(KEY, "google-ads");
    } else {
      const src = sp.get("utm_source");
      if (src && !sessionStorage.getItem(KEY)) sessionStorage.setItem(KEY, src.slice(0, 40));
    }
  } catch { /* storage blocked — attribution is best-effort */ }
}

export function adSource(): string {
  try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; }
}
