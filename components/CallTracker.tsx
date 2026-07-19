"use client";
import { useEffect } from "react";

/**
 * Counts every press of a "Call" button, site-wide, with the page it happened
 * on (so the dashboard can show which products drive calls). One delegated
 * listener — no per-button wiring, so new tel: links are tracked automatically.
 * sendBeacon survives the page being torn down by the phone app opening.
 */
export default function CallTracker() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="tel:"]');
      if (!a) return;
      const path = location.pathname;
      const productSlug = path.startsWith("/products/") ? path.split("/")[2] || "" : "";
      const payload = JSON.stringify({ type: "call_click", path, productSlug });
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
