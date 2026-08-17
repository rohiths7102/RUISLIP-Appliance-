import { getPrisma } from "@/lib/prisma";
import { poaNamesFrom } from "@/lib/select";
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
  mainImage: string; shortDescription: string; descriptionText: string; gtin: string;
};

export async function GET() {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3005").replace(/\/+$/, "");

  try {
    const db = await getPrisma();
    // Call-for-price categories never enter the feed: Google requires the shown
    // price to be honoured, and the owner deliberately doesn't publish these.
    // Read every category and mask through the storefront's helper rather than
    // querying the flags alone — of all the surfaces, this is the worst one to
    // publish a withheld price on when the flags are missing.
    const cats: { name: string; priceOnApplication: boolean }[] =
      await db.category.findMany({ select: { name: true, priceOnApplication: true } });
    const poaNames = [...poaNamesFrom(cats)];
    const rows = await db.product.findMany({
      where: {
        isVisible: true,
        priceNow: { not: null },
        mainImage: { not: "" },
        availabilityNormalised: { in: ["in_stock", "limited"] },
        ...(poaNames.length && { NOT: [{ category: { in: poaNames } }, { subcategory: { in: poaNames } }] }),
      },
      select: {
        productCode: true, title: true, brand: true, slug: true, priceNow: true,
        mainImage: true, shortDescription: true, descriptionText: true, gtin: true,
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
        // slug, not productCode: g:id must be unique per feed, and 8 codes are
        // shared across brands (e.g. Bosch + Neff sell the same OEM part).
        `      <g:id>${esc(p.slug)}</g:id>`,
        `      <title>${title}</title>`,
        `      <description>${desc}</description>`,
        `      <link>${esc(`${base}/products/${p.slug}`)}</link>`,
        `      <g:image_link>${esc(image)}</g:image_link>`,
        `      <g:price>${p.priceNow.toFixed(2)} GBP</g:price>`,
        "      <g:availability>in_stock</g:availability>",
        "      <g:condition>new</g:condition>",
        `      <g:brand>${esc(p.brand)}</g:brand>`,
        `      <g:mpn>${esc(p.productCode)}</g:mpn>`,
        // GTIN is what turns on Google Merchant's free price-benchmark report —
        // Google withholds competitor benchmark data for any item without one.
        // Emitted only when present (from the CIH feed's EAN column); an empty
        // or invalid g:gtin is worse than none and gets the item disapproved.
        ...(p.gtin && /^\d{8,14}$/.test(p.gtin) ? [`      <g:gtin>${esc(p.gtin)}</g:gtin>`] : []),
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
