"use client";
import { useEffect, useState } from "react";
import { MapPin, X, Phone, CheckCircle2 } from "lucide-react";
import { telHref } from "@/lib/format";

const KEY = "er_postcode";

// Local delivery reach around HA4 0QP. Outward-code prefixes we cover directly;
// anything else still gets a "call to confirm" answer, never a hard "no".
const LOCAL = ["HA", "UB", "UXB", "WD", "NW", "TW", "SL", "HP", "W", "IG", "EN"];
const outward = (pc: string) => pc.toUpperCase().replace(/\s+/g, "").match(/^[A-Z]{1,2}/)?.[0] || "";

export default function PostcodePrompt({ phone }: { phone: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [result, setResult] = useState<null | { local: boolean; pc: string }>(null);

  // Pop once on first visit; remember the answer so it never nags a returning customer.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) return;
      const t = setTimeout(() => setOpen(true), 900);
      return () => clearTimeout(t);
    } catch {
      /* private mode: just don't prompt */
    }
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(KEY, result?.pc || "dismissed"); } catch {}
    setOpen(false);
  };

  const check = (e: React.FormEvent) => {
    e.preventDefault();
    const pc = value.trim().toUpperCase();
    if (!pc) return;
    const local = LOCAL.includes(outward(pc));
    setResult({ local, pc });
    try { localStorage.setItem(KEY, pc); } catch {}
    // Note the postcode down for the owner's demand map (anonymous, first-party).
    try {
      fetch("/api/track", {
        method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "postcode_check", postcode: pc, isLocal: local, path: location.pathname }),
      });
    } catch { /* analytics never blocks the prompt */ }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-navy-3/70 p-4 backdrop-blur-sm fade-in" role="dialog" aria-modal="true" aria-label="Check local delivery">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="relative bg-navy px-7 pb-6 pt-7 text-paper">
          <button onClick={dismiss} aria-label="Close" className="absolute right-4 top-4 rounded-full p-1 text-paper/60 hover:text-paper">
            <X size={18} />
          </button>
          <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-blue/20 text-sky">
            <MapPin size={20} />
          </div>
          <h2 className="font-display text-[26px] leading-tight">Do we deliver to you?</h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-[#c3d8ee]">
            We&apos;re a local shop in South Ruislip with our own delivery van. Pop in your postcode and
            we&apos;ll tell you straight away.
          </p>
        </div>

        <div className="p-7">
          {!result ? (
            <form onSubmit={check}>
              <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.16em] text-blue-deep">Your postcode</label>
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="e.g. HA4 0QP"
                  aria-label="Postcode"
                  className="flex-1 rounded-lg border border-line bg-paper-2 px-4 py-3 text-sm uppercase outline-none focus:border-blue"
                />
                <button type="submit" className="rounded-lg bg-blue px-5 py-3 text-sm font-bold text-white hover:bg-blue-deep">
                  Check
                </button>
              </div>
              <button type="button" onClick={dismiss} className="mt-4 text-[12.5px] text-muted hover:text-ink">
                Skip — just browsing
              </button>
            </form>
          ) : (
            <div>
              <div className={`flex items-start gap-3 rounded-lg border p-4 ${result.local ? "border-emerald-200 bg-emerald-50" : "border-blue/20 bg-blue/5"}`}>
                <CheckCircle2 size={20} className={result.local ? "mt-0.5 shrink-0 text-emerald-600" : "mt-0.5 shrink-0 text-blue"} />
                <div className="text-[13.5px] leading-relaxed text-ink">
                  {result.local ? (
                    <><strong>Good news — {result.pc} is in our local area.</strong> We can usually deliver and
                    fit with our own team. Call to confirm your exact date and any access details.</>
                  ) : (
                    <><strong>We may still be able to help with {result.pc}.</strong> For anywhere outside our
                    immediate area we deliver mainland UK via Palletline — give us a call and we&apos;ll sort it.</>
                  )}
                </div>
              </div>
              <a href={telHref(phone)} className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-navy px-5 py-3.5 text-sm font-bold text-white hover:bg-navy-2">
                <Phone size={16} /> Call {phone}
              </a>
              <button onClick={dismiss} className="mt-3 w-full text-[12.5px] text-muted hover:text-ink">
                Continue browsing
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
