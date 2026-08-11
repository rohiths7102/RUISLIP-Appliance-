"use client";
import { useState } from "react";
import { MapPin, Phone, CheckCircle2 } from "lucide-react";
import { telHref } from "@/lib/format";
import { adSource } from "@/lib/ad-source";

// Genuine own-van reach only (HA4 0QP shop). Wider prefixes go via the phone —
// we'd sooner say "call us" than promise a van we can't send. Owner (Aug 2026):
// "we deliver to certain WD, SL postcodes as well" — SL added; exact street is
// still confirmed on the phone, which the result copy already says.
const LOCAL = ["HA", "UB", "WD", "TW", "SL"];
const outward = (pc: string) => pc.toUpperCase().replace(/\s+/g, "").match(/^[A-Z]{1,2}/)?.[0] || "";

/** Inline hero postcode checker — a flat white strip on the royal-blue hero band. */
export default function PostcodeCheck({ phone }: { phone: string }) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<null | { local: boolean; pc: string }>(null);

  const check = (e: React.FormEvent) => {
    e.preventDefault();
    const pc = value.trim().toUpperCase();
    if (!pc) return;
    const local = LOCAL.includes(outward(pc));
    setResult({ local, pc });
    // Same first-party "postcode_check" event the old prompt fired — the owner's
    // demand map and verify-analytics.mjs both depend on this exact shape.
    try {
      fetch("/api/track", {
        method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "postcode_check", postcode: pc, isLocal: local, path: location.pathname, source: adSource() }),
      });
    } catch { /* analytics never blocks the answer */ }
  };

  return (
    <div className="max-w-[440px]">
      <p className="mb-2.5 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-sky">
        <MapPin size={12} /> Do we deliver to you?
      </p>
      <form onSubmit={check}
        className="flex items-center gap-1.5 border border-white/25 bg-white p-1.5">
        <input
          value={value}
          onChange={(e) => { setValue(e.target.value); setResult(null); }}
          placeholder="Your postcode — e.g. HA4 0QP"
          aria-label="Postcode"
          autoComplete="postal-code"
          className="min-w-0 flex-1 bg-transparent px-4 py-2 text-sm uppercase tracking-wide text-ink placeholder:normal-case placeholder:text-muted outline-none"
        />
        <button type="submit"
          className="shrink-0 bg-cta px-5 py-2.5 text-[13px] font-bold text-white transition-colors duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] hover:bg-cta-deep">
          Check
        </button>
      </form>
      {result && (
        <p role="status" className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-[#c3d8ee]">
          <CheckCircle2 size={15} className={`mt-0.5 shrink-0 ${result.local ? "text-success" : "text-sky"}`} />
          <span>
            {result.local ? (
              <>Good news — we deliver to <strong className="text-paper">{result.pc}</strong> with our own van.{" "}
              <a href={telHref(phone)} className="border-b border-sky/50 text-sky hover:text-paper">Call to arrange</a>.</>
            ) : (
              <>We may still be able to help — call us on{" "}
              <a href={telHref(phone)} className="inline-flex items-center gap-1 border-b border-sky/50 font-semibold text-sky hover:text-paper">
                <Phone size={12} /> {phone}
              </a>{" "}and we&apos;ll tell you honestly.</>
            )}
          </span>
        </p>
      )}
    </div>
  );
}
