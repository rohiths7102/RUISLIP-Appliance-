"use client";
import { useEffect } from "react";
import { captureAdSource, adSource } from "@/lib/ad-source";

/**
 * Counts every press of a "Call" button, site-wide, with the page it happened
 * on (so the dashboard can show which products drive calls). One delegated
 * listener — no per-button wiring, so new tel: links are tracked automatically.
 * sendBeacon survives the page being torn down by the phone app opening.
 */
export default function CallTracker() {
  useEffect(() => {
    // Stamp the session's traffic source on landing (gclid/UTMs) so every
    // event below can carry it — this is what powers the admin's Ads page.
    captureAdSource();
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="tel:"]');
      if (!a) return;
      const path = location.pathname;
      const productSlug = path.startsWith("/products/") ? path.split("/")[2] || "" : "";
      const payload = JSON.stringify({ type: "call_click", path, productSlug, source: adSource() });
      try {
        if (!navigator.sendBeacon?.("/api/track", new Blob([payload], { type: "application/json" }))) {
          fetch("/api/track", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: payload });
        }
      } catch { /* analytics never blocks a call */ }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
