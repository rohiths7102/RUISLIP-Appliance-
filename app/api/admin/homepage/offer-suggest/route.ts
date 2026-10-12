import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { suggestOffer, type OfferPage } from "@/lib/offer-ai";
export const dynamic = "force-dynamic";

/**
 * Admin → Homepage → Offers: POST { image, hint } → { alt, href, via }.
 * `image` is the banner's address (our own upload, or an https link); `hint`
 * is anything the owner typed. Only fills the form — saving is still his.
 */
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 20, windowMs: 60_000 });
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  const hint = String(body?.hint || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const imageUrl = String(body?.image || "").trim();
  if (!hint && !imageUrl) return NextResponse.json({ error: "Add the banner picture or a few words about it." }, { status: 400 });

  const db = await getPrisma();
  const [brands, cats] = await Promise.all([
    db.brand.findMany({ where: { isVisible: true, productCount: { gt: 0 } }, select: { name: true, slug: true }, orderBy: { name: "asc" } }),
    db.category.findMany({ where: { productCount: { gt: 0 } }, select: { name: true, slug: true }, orderBy: { name: "asc" } }),
  ]);
  const pages: OfferPage[] = [
    { href: "/products", label: "All appliances" },
    { href: "/delivery-services", label: "Delivery & installation" },
    ...brands.map((b: any) => ({ href: `/brands/${b.slug}`, label: b.name })),
    ...cats.map((c: any) => ({ href: `/categories/${c.slug}`, label: c.name })),
  ];

  // The picture: our own upload ("/uploads/…") or an https link, an image, at most 4 MB.
  let image: { mime: string; b64: string } | undefined;
  if (imageUrl && (imageUrl.startsWith("/") || imageUrl.startsWith("https://"))) {
    try {
      const r = await fetch(new URL(imageUrl, req.url), { signal: AbortSignal.timeout(10000) });
      const mime = (r.headers.get("content-type") || "").split(";")[0];
      const bytes = Buffer.from(await r.arrayBuffer());
      if (r.ok && /^image\/(png|jpeg|webp|gif)$/.test(mime) && bytes.length <= MAX_BYTES) image = { mime, b64: bytes.toString("base64") };
    } catch { /* read the words instead */ }
  }

  return NextResponse.json(await suggestOffer({ image, hint, pages }));
}
