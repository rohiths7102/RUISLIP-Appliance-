import { revalidatePath } from "next/cache";

/**
 * Purge the storefront's ISR cache after an admin write, so edits show up
 * instantly in production instead of waiting out the 300s revalidate window.
 * Fire-and-forget: cache invalidation must never fail the write it follows.
 */
export function revalidateStorefront(extra: string[] = []) {
  try {
    for (const p of ["/", "/products", "/categories", "/brands", ...extra]) revalidatePath(p);
  } catch {
    /* best effort */
  }
}
