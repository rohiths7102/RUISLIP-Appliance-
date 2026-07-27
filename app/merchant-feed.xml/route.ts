import { getPrisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

/** Escape the five XML special characters for safe element content. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Google Merchant Center feed (RSS 2.0) for free Shopping listings.
 * Only products with a price, an image and a promisable stock status are listed —
 * the ~474 "call_to_confirm" products are EXCLUDED deliberately: we never claim
 * availability we can't promise, so Google only sees stock we'd stand behind on the phone.
 */
type FeedRow = {
  productCode: string; title: string; brand: string; slug: string; priceNow: number;
  mainImage: string; shortDescription: string; descriptionText: string;
};

export async function GET() {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3005").replace(/\/+$/, "");

  try {
    const db = await getPrisma();
    const rows = await db.product.findMany({
      where: {
        isVisible: true,
        priceNow: { not: null },
        mainImage: { not: "" },
        availabilityNormalised: { in: ["in_stock", "limited"] },
      },
      select: {
        productCode: true, title: true, brand: true, slug: true, priceNow: true,
        mainImage: true, shortDescription: true, descriptionText: true,
      },
      orderBy: { productCode: "asc" },
    });

    const items = (rows as FeedRow[]).map((p) => {
      const title = esc(p.title.slice(0, 150));
      // Prefer the short blurb, fall back to the long text, then the title — Google rejects empty descriptions.
      const desc = esc((p.shortDescription || p.descriptionText || p.title).slice(0, 5000));
      const image = /^https?:\/\//.test(p.mainImage) ? p.mainImage : `${base}${p.mainImage.startsWith("/") ? "" : "/"}${p.mainImage}`;
      return [
        "    <item>",
        `      <g:id>${esc(p.productCode)}</g:id>`,
        `      <title>${title}</title>`,
        `      <description>${desc}</description>`,
        `      <link>${esc(`${base}/products/${p.slug}`)}</link>`,
        `      <g:image_link>${esc(image)}</g:image_link>`,
        `      <g:price>${p.priceNow.toFixed(2)} GBP</g:price>`,
        "      <g:availability>in_stock</g:availability>",
        "      <g:condition>new</g:condition>",
        `      <g:brand>${esc(p.brand)}</g:brand>`,
        `      <g:mpn>${esc(p.productCode)}</g:mpn>`,
        "    </item>",
      ].join("\n");
    });

    const xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">`,
      "  <channel>",
      "    <title>Euronics Ruislip</title>",
      `    <link>${esc(base)}</link>`,
      "    <description>Kitchen appliances in Ruislip — browse online, call to confirm and order.</description>",
      ...items,
      "  </channel>",
      "</rss>",
      "",
    ].join("\n");

    return new Response(xml, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (e) {
    console.error("merchant-feed GET", e);
    return new Response("Feed temporarily unavailable", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
