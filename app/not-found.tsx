import Link from "next/link";
import { Phone } from "lucide-react";
import { telHref, STORE_PHONE } from "@/lib/format";

export default function NotFound() {
  return (
    <div className="container-x flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-blue-deep">— 404</p>
      <h1 className="mt-4 font-display text-[clamp(32px,5vw,54px)] font-normal leading-tight">
        We couldn&apos;t find that page.
      </h1>
      <p className="mt-3 max-w-md text-muted">
        It may have moved. Browse the range instead, or call the shop and we&apos;ll find what you need.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/products" className="rounded-sm bg-navy px-6 py-3 text-sm font-semibold text-paper hover:bg-navy-2">
          Browse appliances
        </Link>
        <a href={telHref(STORE_PHONE)} className="inline-flex items-center gap-2 rounded-sm border border-ink/20 px-6 py-3 text-sm font-semibold hover:border-blue hover:text-blue-deep">
          <Phone size={15} /> {STORE_PHONE}
        </a>
      </div>
    </div>
  );
}
