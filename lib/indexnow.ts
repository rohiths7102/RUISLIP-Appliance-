import { SITE } from "@/lib/seo";

/**
 * IndexNow: tells Bing (and through it Copilot, plus Yandex, Seznam and Naver)
 * which pages changed, so they're re-read in hours, not weeks. Two days after
 * the 22 Sept 2026 cutover Bing still showed the old site's titles. The key is
 * public by design: Bing checks it against /<key>.txt (in public/) on this host.
 */
export const INDEXNOW_KEY = "132aedaa5860f73d63a3a21490d2a58d";

export async function indexNow(urls: string[]): Promise<number> {
  if (!urls.length) return 0;
  const base = SITE().replace(/\/+$/, "");
  const r = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: new URL(base).host, key: INDEXNOW_KEY, keyLocation: `${base}/${INDEXNOW_KEY}.txt`, urlList: urls.slice(0, 10_000) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`IndexNow ${r.status}`);
  return Math.min(urls.length, 10_000);
}
