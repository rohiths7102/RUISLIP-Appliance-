import { poaNamesFrom } from "@/lib/select";

/** Stock states the shop will stand behind on the phone, so Google may list them. */
export const FEED_AVAILABILITY = ["in_stock", "limited", "to_order"];

export type FeedRow = {
  productCode: string; title: string; brand: string; slug: string; priceNow: number;
  mainImage: string; shortDescription: string; descriptionText: string; gtin: string;
  availabilityNormalised: string;
};

/**
 * The products Google gets: visible, priced, photographed and in stock or
 * available to order (Google's "backorder"), never call-for-price. Shared by merchant-feed.xml and local-inventory-feed.xml, whose
 * ids (the slug) must match item for item or Merchant Center flags the gap.
 */
export async function feedRows(db: any): Promise<FeedRow[]> {
  // Call-for-price categories never enter the feed: Google requires the shown
  // price to be honoured, and the owner deliberately doesn't publish these.
  // Read every category and mask through the storefront's helper rather than
  // querying the flags alone — of all the surfaces, this is the worst one to
  // publish a withheld price on when the flags are missing.
  const cats: { name: string; priceOnApplication: boolean }[] =
    await db.category.findMany({ select: { name: true, priceOnApplication: true } });
  const brands: { name: string; priceOnApplication: boolean }[] =
    await db.brand.findMany({ select: { name: true, priceOnApplication: true } }).catch(() => []);
  const poaNames = [...poaNamesFrom(cats, brands)];
  return db.product.findMany({
    where: {
      isVisible: true,
      priceNow: { not: null },
      mainImage: { not: "" },
      availabilityNormalised: { in: FEED_AVAILABILITY },
      ...(poaNames.length && { NOT: [{ category: { in: poaNames } }, { subcategory: { in: poaNames } }, { brand: { in: poaNames } }] }),
    },
    select: {
      productCode: true, title: true, brand: true, slug: true, priceNow: true,
      mainImage: true, shortDescription: true, descriptionText: true, gtin: true,
      availabilityNormalised: true,
    },
    orderBy: { productCode: "asc" },
  });
}
