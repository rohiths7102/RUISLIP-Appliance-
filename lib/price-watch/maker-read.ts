import { fetchPage } from "@/lib/page-reader";
import { readMakerPrice, MAKER_HOSTS } from "@/lib/maker-price";
import { isBestSeller } from "@/lib/best-sellers";

/**
 * Read Bosch's and Neff's own page for every best seller and save what each
 * says as a "manufacturer-rrp" observation — the numbers the price agent then
 * applies (lib/price-watch/auto-apply.ts). Runs from /api/cron/maker-prices on
 * the site itself, so Sachin's best sellers do not wait on the Oracle box's
 * collector, which reads only the structured price and so missed a third of
 * them (see lib/maker-price.ts).
 *
 * ~75 pages, six at a time: well inside the function's minute. A page not
 * started by `deadlineMs` is left for tomorrow and counted, never dropped
 * silently; a page that could not be read is saved as such, so a dead reader
 * cannot look like a stable price.
 */
export type MakerReadTally = { pages: number; priced: number; discontinued: number; unread: number; notReached: number };

const NOTE: Record<string, string> = {
  discontinued: "maker page: no longer available — price kept",
  no_price: "maker page: no price shown",
  prices_disagree: "maker page: two different prices — not read",
  other_model: "maker page is about another model",
};

export async function readMakerPrices(
  db: any,
  opts: { deadlineMs?: number; concurrency?: number; fetcher?: (url: string) => Promise<{ html: string }> } = {},
): Promise<MakerReadTally> {
  const started = Date.now();
  const deadlineMs = opts.deadlineMs ?? 40_000;
  const fetcher = opts.fetcher ?? fetchPage;
  const host = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };

  const rows = await db.product.findMany({
    where: { isVisible: true, brand: { in: ["Bosch", "BOSCH", "Neff", "NEFF"] } },
    select: { id: true, productCode: true, sourceUrl: true },
  });
  const targets = rows.filter((p: any) => isBestSeller(p.productCode || "") && MAKER_HOSTS.test(host(p.sourceUrl || "")));
  const tally: MakerReadTally = { pages: targets.length, priced: 0, discontinued: 0, unread: 0, notReached: 0 };
  const observations: any[] = [];

  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      if (Date.now() - started > deadlineMs) { tally.notReached += targets.length - next; next = targets.length; return; }
      const p = targets[next++];
      const base = { productId: p.id, sourceId: "manufacturer-rrp", deliveryCost: null, includesVat: true, sourceUrl: p.sourceUrl, matchConfidence: 1 };
      try {
        const r = readMakerPrice((await fetcher(p.sourceUrl)).html, p.productCode);
        if (r.price !== null) {
          tally.priced++;
          observations.push({ ...base, price: r.price, inStock: r.inStock, status: "ok",
            note: r.from === "offer" ? "maker page (site reader)" : "maker page, price on screen — their shop: unavailable (site reader)" });
        } else {
          if (r.reason === "discontinued") tally.discontinued++; else tally.unread++;
          observations.push({ ...base, price: null, inStock: null, status: "parse_failed", note: NOTE[r.reason] });
        }
      } catch (e: any) {
        tally.unread++;
        observations.push({ ...base, price: null, inStock: null, status: "parse_failed", note: `maker page not read: ${String(e?.message || e).slice(0, 120)}` });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, targets.length || 1) }, worker));
  if (observations.length) await db.priceObservation.createMany({ data: observations });
  return tally;
}
