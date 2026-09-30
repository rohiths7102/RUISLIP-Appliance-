import { servicePricesFor } from "@/lib/service-prices";

/** Sachin's delivery, fitting and disposal prices — all of them, or one department's. */
export default function ServicePrices({ dept }: { dept?: string }) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {servicePricesFor(dept).map((g) => (
        <div key={g.heading} className="rounded-[4px] border border-ink/10 bg-card p-6">
          <h3 className="mb-3 font-display text-[19px]">{g.heading}</h3>
          <dl className="divide-y divide-ink/10">
            {g.items.map((i) => (
              <div key={i.what} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-[13.5px] leading-snug text-muted">{i.what}</dt>
                <dd className="shrink-0 text-[14.5px] font-semibold tabular-nums text-ink">{i.price}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
