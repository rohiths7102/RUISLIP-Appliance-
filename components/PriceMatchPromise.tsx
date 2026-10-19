import { waHref } from "@/lib/format";

/**
 * Sachin's Price Match Promise (19 Oct 2026), next to every appliance: a £
 * badge with a tick, the promise, and on the product page a "Found a cheaper
 * price?" link that opens WhatsApp with the model already named, so the shop
 * can check the other retailer's price and answer. On a product card (itself
 * one big link) it is the promise alone.
 */
export const showsPriceMatch = (category: string) => category !== "Accessories & Spare Parts";

function Badge({ size }: { size: number }) {
  return (
    <span aria-hidden className="relative inline-flex shrink-0 items-center justify-center rounded-full bg-blue text-white" style={{ width: size, height: size }}>
      <span className="font-bold leading-none" style={{ fontSize: size * 0.56 }}>£</span>
      <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-cta text-white ring-2 ring-white" style={{ width: size * 0.48, height: size * 0.48 }}>
        <svg viewBox="0 0 12 12" width={size * 0.3} height={size * 0.3} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.2 2.2L9.5 3.5" /></svg>
      </span>
    </span>
  );
}

export default function PriceMatchPromise({ code, title, compact = false }: { code: string; title: string; compact?: boolean }) {
  if (compact) {
    return (
      <span className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-blue-deep">
        <Badge size={16} /> Price Match Promise
      </span>
    );
  }
  const message = `Hi, I've found the ${code} (${title}) cheaper elsewhere. Can you match it? Here's where I saw it: `;
  return (
    <div className="mb-6 flex items-center gap-3">
      <Badge size={38} />
      <div className="leading-tight">
        <p className="text-[16px] font-semibold text-ink">Price Match Promise</p>
        <a href={`${waHref()}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"
          className="text-[14px] text-blue-deep underline underline-offset-2 hover:text-blue">
          Found a cheaper price? Tell us
        </a>
      </div>
    </div>
  );
}
