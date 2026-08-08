import { revalidatePath } from "next/cache";

/** A write that names only product detail pages can be purged exactly; anything else fans out. */
const PRODUCT_DETAIL = /^\/products\/[^/]+$/;

/**
 * Purge the storefront's ISR cache after an admin write, so edits show up
 * instantly in production instead of waiting out the 300s revalidate window.
 * Fire-and-forget: cache invalidation must never fail the write it follows.
 *
 * Pass the exact paths the write touched in `extra`; they are purged alongside
 * the four listing roots. Purging the `/products/[slug]` route pattern instead
 * would evict all ~1,800 product pages for a single price edit, and the next
 * visitor to each one pays a cold render that reloads the whole catalogue — a
 * twenty-edit admin session would purge the entire site twenty times over.
 *
 * Department and brand pages are ALWAYS purged by pattern. There are only ~96 of
 * them, they list the product cards a write just changed, and skipping them left
 * a deleted appliance linked from its department page until the ISR window
 * expired — a 404 for whoever clicked it.
 *
 * `allPages` additionally purges the ~1,800 `/products/[slug]` pages, for a write
 * whose effect really does reach every one of them — so no detail page can keep
 * showing something the owner just changed (a price he hid above all). Use it for:
 *   - a category call-for-price flip (nulls the price on every product in it)
 *   - a category rename, or a brand visibility change
 *   - business details, which render in the header of every page
 *   - a bulk edit, an import, or a sync apply
 * It is implied whenever `extra` is empty or names anything other than product
 * detail pages, so a caller that cannot narrow its write stays safe by default.
 */
export function revalidateStorefront(extra: string[] = [], opts: { allPages?: boolean } = {}) {
  try {
    for (const p of ["/", "/products", "/categories", "/brands", ...extra]) revalidatePath(p);
    for (const p of ["/categories/[slug]", "/brands/[slug]"]) revalidatePath(p, "page");
    if (opts.allPages || !extra.length || !extra.every((p) => PRODUCT_DETAIL.test(p))) {
      revalidatePath("/products/[slug]", "page");
    }
  } catch {
    /* best effort */
  }
}
