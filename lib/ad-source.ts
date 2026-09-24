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
      // Otherwise the site they arrived from (host only), so a call or enquiry
      // later in the visit can be credited to Google, ChatGPT, Facebook…
      const ref = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : "";
      if (ref && ref !== location.hostname && !sessionStorage.getItem(KEY)) sessionStorage.setItem(KEY, ref.slice(0, 40));
    }
  } catch { /* storage blocked — attribution is best-effort */ }
}

export function adSource(): string {
  try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; }
}

/**
 * The Google Ads click id, read from Google's own conversion-linker cookie
 * (_gcl_aw = "GCL.<time>.<gclid>"). That cookie only exists when the visitor
 * accepted cookies (ConsentAnalytics grants ad_storage), so this returns ""
 * for anyone who declined — the site never stores the click id itself.
 */
export function adClickId(): string {
  try {
    const m = document.cookie.match(/(?:^|;\s*)_gcl_aw=([^;]+)/);
    const id = m ? decodeURIComponent(m[1]).split(".").slice(2).join(".") : "";
    return /^[A-Za-z0-9_-]{10,200}$/.test(id) ? id : "";
  } catch { return ""; }
}
