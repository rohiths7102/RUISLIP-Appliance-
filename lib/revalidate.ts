import { revalidatePath } from "next/cache";

/**
 * Purge the storefront's ISR cache after an admin write, so edits show up
 * instantly in production instead of waiting out the 300s revalidate window.
 * Fire-and-forget: cache invalidation must never fail the write it follows.
 */
export function revalidateStorefront(extra: string[] = []) {
  try {
    for (const p of ["/", "/products", "/categories", "/brands", ...extra]) revalidatePath(p);
    // Detail pages surface the same data (price, visibility, call-for-price flag)
    // — purge every rendered slug via the route pattern, or a PDP could show a
    // price the owner just hid for up to `revalidate` seconds.
    for (const p of ["/products/[slug]", "/categories/[slug]", "/brands/[slug]"]) revalidatePath(p, "page");
  } catch {
    /* best effort */
  }
}
