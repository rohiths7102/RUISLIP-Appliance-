import { getPrisma } from "@/lib/prisma";
import { feedRows } from "@/lib/merchant-feed";
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Google local product inventory feed: which of the merchant-feed products are
 * on the shop floor. Merchant Center flagged 326 products "Missing local
 * inventory data" (27 Sept 2026) because free local listings were switched on
 * with no stock data behind them. Same rows and same ids as merchant-feed.xml.
 *
 * MERCHANT_STORE_CODE is the store code of the shop's Google Business Profile
 * location, as Merchant Center shows it (Settings → Business info → Stores).
 */
export async function GET() {
  const store = process.env.MERCHANT_STORE_CODE;
  if (!store) {
    return new Response("MERCHANT_STORE_CODE is not set", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  try {
    const rows = await feedRows(await getPrisma());
    const items = rows.map((p) => [
      "    <item>",
      `      <g:store_code>${esc(store)}</g:store_code>`,
      `      <g:id>${esc(p.slug)}</g:id>`,
      `      <g:availability>${p.availabilityNormalised === "limited" ? "limited_availability" : p.availabilityNormalised === "to_order" ? "on_display_to_order" : "in_stock"}</g:availability>`,
      `      <g:price>${p.priceNow.toFixed(2)} GBP</g:price>`,
      "    </item>",
    ].join("\n"));
    const xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">`,
      "  <channel>",
      "    <title>Euronics Ruislip local inventory</title>",
      ...items,
      "  </channel>",
      "</rss>",
      "",
    ].join("\n");
    return new Response(xml, {
      headers: { "content-type": "application/xml; charset=utf-8", "Cache-Control": "public, s-maxage=300" },
    });
  } catch (e) {
    console.error("local-inventory-feed GET", e);
    return new Response("Feed temporarily unavailable", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
