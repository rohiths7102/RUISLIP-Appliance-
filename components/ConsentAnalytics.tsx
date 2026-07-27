"use client";
import { useEffect, useState } from "react";
import Script from "next/script";

const KEY = "ga-consent";
// Inlined at build time. Empty/unset = no banner, no scripts, no cookies —
// the site stays exactly as cookieless as it is today.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID || "";

type Choice = "granted" | "denied";

/**
 * UK-compliant (PECR/UK GDPR) opt-in analytics. Nothing loads until the
 * visitor explicitly accepts; "No thanks" loads nothing, ever. The choice is
 * remembered in localStorage so the banner appears once per browser.
 */
export default function ConsentAnalytics() {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [ready, setReady] = useState(false); // banner renders post-mount only, so SSR/first paint match

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "granted" || saved === "denied") setChoice(saved);
    } catch { /* private mode: can't persist — banner shows, choice lasts the session */ }
    setReady(true);
  }, []);

  if (!GA_ID) return null;

  const decide = (v: Choice) => {
    try { localStorage.setItem(KEY, v); } catch {}
    setChoice(v);
  };

  return (
    <>
      {ready && choice === null && (
        <div
          role="dialog"
          aria-label="Analytics cookies"
          aria-describedby="ga-consent-copy"
          className="fixed bottom-4 left-4 z-[60] max-w-sm rounded-xl border border-line bg-white p-5 shadow-2xl cta-up"
        >
          <p id="ga-consent-copy" className="text-sm leading-relaxed text-ink">
            <strong>Help us improve the site?</strong> We&apos;d like to use anonymous Google
            Analytics to see which pages help customers most. No marketing or advertising
            cookies — ever.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => decide("granted")}
              className="rounded-lg bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
            >
              Accept
            </button>
            <button
              onClick={() => decide("denied")}
              className="rounded-lg px-3 py-2.5 text-sm font-semibold text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
            >
              No thanks
            </button>
          </div>
        </div>
      )}

      {choice === "granted" && (
        <>
          {/* Consent mode v2: defaults queue on dataLayer before gtag.js loads.
              Only analytics_storage is granted — ad_* stays denied (no ads run). */}
          <Script id="ga-init" strategy="afterInteractive">{`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('consent', 'default', {
              ad_storage: 'denied',
              ad_user_data: 'denied',
              ad_personalization: 'denied',
              analytics_storage: 'denied'
            });
            gtag('consent', 'update', { analytics_storage: 'granted' });
            gtag('js', new Date());
            gtag('config', '${GA_ID}');
          `}</Script>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
        </>
      )}
    </>
  );
}
