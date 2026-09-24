"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { captureAdSource, adSource } from "@/lib/ad-source";
import { reportAdsConversion } from "@/lib/google-ads";

/**
 * Counts every press of a "Call" button, site-wide, with the page it happened
 * on (so the dashboard can show which products drive calls). One delegated
 * listener — no per-button wiring, so new tel: links are tracked automatically.
 * sendBeacon survives the page being torn down by the phone app opening.
 */
// First page of this tab's visit: an arrival from another site (or typed in),
// not a reload and not an in-site click. Module scope: once per page load.
let firstView = true;

// The back office (app/admin/layout.tsx marks it, whatever its public URL).
// Sachin tapping a customer's number in Sales & Leads is not a website call —
// counted, it inflated "Call taps" and could fire the Google Ads call conversion
// the campaign bids on.
const inBackOffice = () => !!document.querySelector("[data-admin-shell]");

const beacon = (payload: string) => {
  try {
    if (!navigator.sendBeacon?.("/api/track", new Blob([payload], { type: "application/json" }))) {
      fetch("/api/track", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: payload });
    }
  } catch { /* analytics never blocks the page */ }
};

export default function CallTracker() {
  const pathname = usePathname();

  // Anonymous page views for Admin → Telemetry: the page, and for the first
  // page of a visit, the site the visitor came from (host only). No cookies,
  // nothing that identifies anyone. The back office is not counted.
  useEffect(() => {
    if (!pathname) return;
    if (inBackOffice()) { firstView = false; return; }
    let referrer = "", landing = false;
    if (firstView) {
      firstView = false;
      const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
      try { referrer = document.referrer ? new URL(document.referrer).hostname : ""; } catch {}
      landing = nav?.type !== "reload" && referrer !== location.hostname;
      if (referrer === location.hostname) referrer = "";
    }
    const productSlug = pathname.startsWith("/products/") ? pathname.split("/")[2] || "" : "";
    beacon(JSON.stringify({ type: "page_view", path: pathname, productSlug, source: adSource(), referrer, landing }));
  }, [pathname]);

  useEffect(() => {
    // Stamp the session's traffic source on landing (gclid/UTMs) so every
    // event below can carry it — this is what powers the admin's Ads page.
    captureAdSource();
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="tel:"]');
      if (!a || inBackOffice()) return;
      const path = location.pathname;
      const productSlug = path.startsWith("/products/") ? path.split("/")[2] || "" : "";
      beacon(JSON.stringify({ type: "call_click", path, productSlug, source: adSource() }));
      reportAdsConversion("call");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
