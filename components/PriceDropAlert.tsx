"use client";
import { useState } from "react";
import { Bell, Check } from "lucide-react";

/** "Email me if the price drops" on a priced product page (app/api/price-alert, lib/price-alerts.ts). */
export default function PriceDropAlert({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("busy"); setError("");
    const company = (new FormData(e.currentTarget).get("company") as string) || "";
    const r = await fetch("/api/price-alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, email, company }) }).catch(() => null);
    const j: any = await r?.json().catch(() => null);
    if (r?.ok) setState("done");
    else { setState("idle"); setError(j?.error || "That didn't work; please try again or call us."); }
  }

  if (state === "done") return (
    <p className="mb-6 flex items-center gap-2 text-[14px] text-success"><Check size={16} aria-hidden /> Done. We'll email you once if the price drops.</p>
  );
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className="mb-6 inline-flex items-center gap-2 text-[14px] font-medium text-blue-deep underline underline-offset-2 hover:text-blue">
      <Bell size={15} aria-hidden /> Email me if the price drops
    </button>
  );
  return (
    <form onSubmit={submit} className="mb-6 max-w-md">
      <label htmlFor="price-alert-email" className="mb-1.5 block text-[14px] font-semibold text-ink">Email me if the price drops</label>
      <div className="flex gap-2">
        <input id="price-alert-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
          className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-blue" />
        <input name="company" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
        <button type="submit" disabled={state === "busy"} className="rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Watch price</button>
      </div>
      {error && <p className="mt-1.5 text-[13px] text-red-700" role="alert">{error}</p>}
      <p className="mt-1.5 text-[12px] text-ink/70">One email if it gets cheaper, then we delete your address. No newsletters. <a href="/privacy" className="underline underline-offset-2">Privacy</a></p>
    </form>
  );
}
