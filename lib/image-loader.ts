/**
 * next/image loader that never touches Vercel's Image Optimization. On the
 * Hobby plan that quota runs out (23 Sept 2026: every un-cached /_next/image
 * returned 402 OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED, blanking most TV
 * photos). Instead:
 *   - Euronics (Amplience) and Contentful resize on their own CDNs via ?w=
 *   - everything else — our /catalog webp files, Bosch media — is served as is
 */
export default function imageLoader({ src, width, quality }: { src: string; width: number; quality?: number }): string {
  const w = Math.min(width, 1600);
  if (src.startsWith("https://cdn.media.amplience.net/")) return `${src}${src.includes("?") ? "&" : "?"}w=${w}&qlt=${quality || 75}`;
  if (src.startsWith("https://images.eu.ctfassets.net/")) return `${src}${src.includes("?") ? "&" : "?"}w=${w}&q=${quality || 75}`;
  return src;
}
