"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Phone } from "lucide-react";
import { telHref, STORE_PHONE } from "@/lib/format";

export default function ContactForm() {
  const sp = useSearchParams();
  const product = sp.get("product") || "";
  const code = sp.get("code") || "";
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    company: "", // honeypot — real people never see this
    message: product ? `Hi, I'd like to ask about the ${product} (product code ${code}). ` : "",
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, productCode: code, productTitle: product }),
      });
      if (r.ok) setSent(true);
      else setError("We couldn't send that online — please call the shop and we'll sort it straight away.");
    } catch {
      setError("We couldn't send that online — please call the shop and we'll sort it straight away.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-[4px] border border-blue/50 bg-blue/[.08] p-10 text-center">
        <h2 className="mb-2.5 font-display text-[28px]">Thanks — we&apos;ll be in touch</h2>
        <p className="text-[14.5px] leading-relaxed text-[#44586f]">
          Your enquiry{code ? <> about <strong className="font-mono text-blue-deep">{code}</strong></> : null} has
          been logged. For the quickest answer on availability, give us a ring on{" "}
          <a href={telHref(STORE_PHONE)} className="font-bold text-blue-deep no-underline hover:underline">
            {STORE_PHONE}
          </a>{" "}
          during opening hours.
        </p>
      </div>
    );
  }

  const field = "w-full rounded-sm border border-ink/15 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue";

  return (
    <form onSubmit={submit} className="rounded-[4px] border border-ink/10 bg-card p-7">
      <h2 className="mb-1.5 font-display text-[26px]">Send an enquiry</h2>
      <p className="mb-6 text-[13px] text-muted">We aim to reply the same working day. Prefer to talk? Just call.</p>

      {code && (
        <div className="mb-4 rounded-sm border border-blue/30 bg-blue/[.07] px-3.5 py-2.5 text-sm">
          Enquiry for <strong>{product}</strong> — code <strong className="font-mono text-blue-deep">{code}</strong>
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-sm border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
          <Phone size={14} /> {error}
        </div>
      )}

      <div className="grid gap-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <input required placeholder="Your name" value={form.name} onChange={set("name")} className={field} aria-label="Your name" />
          <input required type="tel" placeholder="Phone number" value={form.phone} onChange={set("phone")} className={field} aria-label="Phone number" />
        </div>
        <input type="email" placeholder="Email (optional)" value={form.email} onChange={set("email")} className={field} aria-label="Email" />
        <textarea required rows={5} value={form.message} onChange={set("message")} aria-label="Message"
          placeholder="Which appliance are you interested in? Include the product code if you have it."
          className={`${field} resize-y leading-relaxed`} />

        {/* honeypot */}
        <input type="text" name="company" value={form.company} onChange={set("company")} tabIndex={-1}
          autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />

        <button type="submit" disabled={busy}
          className="rounded-sm bg-navy px-5 py-3.5 text-[15px] font-bold text-paper transition-colors hover:bg-navy-2 disabled:opacity-50">
          {busy ? "Sending…" : "Send enquiry"}
        </button>
      </div>
    </form>
  );
}
