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
};
export default nextConfig;
