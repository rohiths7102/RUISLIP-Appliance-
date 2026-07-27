import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function readJson(f) {
  try { const p = join(process.cwd(), "data", f); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : []; }
  catch { return []; }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets `npm run build:check` build into .next-check so a production build can be
  // verified without clobbering a running dev server's chunks.
  distDir: process.env.NEXT_DIST || ".next",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.ssl.cf3.rackcdn.com" },
      { protocol: "https", hostname: "www.kitchen-appliances.co.uk" },
    ],
  },
  async redirects() {
    const products = readJson("products.json");
    const categories = readJson("categories.json");
    const out = [];
    const seen = new Set();
    const add = (source, destination) => {
      if (!source || !destination || !source.startsWith("/") || source === destination || seen.has(source)) return;
      seen.add(source); out.push({ source, destination, permanent: true });
    };
    for (const p of products) add(p.oldUrl, p.newSlug);                 // /…/p-4561 -> /products/slug
    for (const c of categories) add(c.slug, `/categories/${c.id}`);     // /laundry/washing-machines -> /categories/washing-machines
    return out;
  },
  // Baseline security headers on every route. No CSP yet — it would break inline
  // scripts/JSON-LD; noted for later hardening.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Stops browsers MIME-sniffing responses into executable types.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Blocks cross-origin framing (clickjacking); same-origin embeds still work.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Full referrer same-origin only; origin-only downgraded/cross-origin.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Denies powerful device APIs the site never uses.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Allows DNS prefetch of external hosts (e.g. image CDN) for faster loads.
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};
export default nextConfig;
