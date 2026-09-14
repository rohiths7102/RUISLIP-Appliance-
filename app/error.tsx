"use client";
import { STORE_PHONE, telHref } from "@/lib/format";

/**
 * Shown when a page cannot render. Since 14 Sept 2026 that includes a
 * production database read failing — which used to hide behind the seed
 * catalogue as stale prices on a page that returned 200. Phone-first like the
 * rest of the shop: the customer can still ask, and the fault stays visible.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="container-x py-24 text-center">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.24em] text-blue-deep">— Something went wrong</p>
      <h1 className="mb-4 font-display text-display-2 font-normal">We can&rsquo;t load this page right now</h1>
      <p className="mx-auto mb-8 max-w-md text-[15px] text-muted">
        The catalogue didn&rsquo;t respond. Try again in a moment, or call us &mdash; we can check stock and
        price for you on the phone.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button onClick={reset}
          className="inline-flex min-h-11 items-center border border-blue/30 px-5 text-[13px] font-semibold text-blue transition-colors hover:border-blue hover:bg-blue hover:text-white">
          Try again
        </button>
        <a href={telHref(STORE_PHONE)}
          className="inline-flex min-h-11 items-center gap-2 bg-cta px-5 text-[13px] font-bold text-white transition-colors hover:bg-cta-deep">
          Call {STORE_PHONE}
        </a>
      </div>
    </main>
  );
}
