/**
 * "Scrape a page" — the owner pastes a product URL, we read the page on his
 * behalf and tell him what we found; a second call creates or updates.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS ROUTE IS AN SSRF SINK.
 * It makes the SERVER fetch a URL chosen by the caller. On a hosted platform the
 * server sits inside a private network next to the database, the metadata
 * service (169.254.169.254) and any internal admin ports — all of which are
 * reachable from there and from nowhere else. So every URL, and every redirect
 * hop, is validated before a socket is opened:
 *
 *   1. https only (no http, file:, gopher:, data:, ftp: …)
 *   2. no credentials in the URL (https://user:pass@host — some fetchers leak them)
 *   3. port must be the default 443 — no probing 127.0.0.1:5432-style internals
 *   4. hostname must be a real public name: has a dot, is not `localhost`, and
 *      does not end in .local / .internal / .localdomain / .home.arpa / .lan
 *   5. EVERY resolved address (A + AAAA, and IP literals) must be public —
 *      loopback, private, link-local, CGNAT, multicast, reserved and the
 *      IPv4-mapped / 6to4 / NAT64 v6 forms that smuggle a v4 address are refused
 *   6. redirects are followed MANUALLY (redirect: "manual"), max 3 hops, and
 *      every hop goes back through 1-5 — a public URL that 302s to
 *      http://169.254.169.254/ is the classic bypass
 *   7. 15s deadline across all hops, and the body is read in chunks and abandoned
 *      past 3MB so a hostile/huge page cannot exhaust server memory
 *   8. only HTML content types are read
 *
 * Residual risk, stated honestly: between our DNS check and fetch's own
 * resolution a name could be re-pointed at a private address (DNS rebinding).
 * Closing that needs connection-level pinning; the checks above plus the
 * admin-session + rate-limit gate are the mitigation we have here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { revalidateStorefront } from "@/lib/revalidate";
import { EDITABLE, coerce, slugify, reconcileSaving, ValidationError } from "@/lib/admin-product";
import { ensureBrand, recomputeCounts } from "@/lib/counts";
import { syncProductToRag } from "@/lib/rag/index";
import { LookupError, fetchPage, extract, type Found } from "@/lib/page-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════ matching ══ */

/** Model codes are written inconsistently ("KGN39VLEAG", "kgn-39 vleag"). */
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

type MatchRow = { id: string; title: string; productCode: string; brand: string; slug: string; priceNow: number | null };

async function findMatch(db: any, found: Found): Promise<MatchRow | null> {
  const code = normCode(found.productCode);
  const select = { id: true, title: true, productCode: true, brand: true, slug: true, priceNow: true };

  if (found.gtin) {
    const byGtin = await db.product.findFirst({ where: { gtin: found.gtin }, select });
    if (byGtin) return byGtin as MatchRow;
  }
  if (!code) return null;

  // Indexed exact hit first — covers the overwhelming majority.
  const exact = await db.product.findFirst({ where: { productCode: found.productCode.trim() }, select });
  if (exact) return exact as MatchRow;

  // Otherwise compare normalised. The catalogue is ~1,800 rows of two short
  // columns; doing it in JS keeps the comparison identical on sqlite and Postgres.
  const all = await db.product.findMany({ select });
  for (const p of all as MatchRow[]) if (normCode(p.productCode || "") === code) return p;
  return null;
}

/* ═══════════════════════════════════════════════════════════════════ POST ══ */

/** Fields a scrape may fill in — but ONLY when the product's own value is empty. */
const FILL_IF_EMPTY = ["title", "brand", "productCode", "shortDescription", "descriptionText", "mainImage", "gtin"] as const;

function foundValueFor(field: string, found: Found): string {
  switch (field) {
    case "title": return found.title;
    case "brand": return found.brand;
    case "productCode": return found.productCode;
    case "shortDescription": return found.description.slice(0, 300);
    case "descriptionText": return found.description;
    case "mainImage": return "";  // never store a remote URL — next/image only serves configured hosts
    case "gtin": return found.gtin;
    default: return "";
  }
}

const LABEL: Record<string, string> = {
  title: "name", brand: "brand", productCode: "model number", shortDescription: "short description",
  descriptionText: "description", mainImage: "photo", gtin: "barcode", priceNow: "price", priceWas: "was-price",
};

export async function POST(req: Request) {
  // Session auth (401 when absent) + a per-route rate limit. This route makes the
  // SERVER open outbound connections, so it is deliberately tighter than an
  // ordinary product save.
  const gate = await requireAdminApi(req, { limit: 20, windowMs: 60_000, bucket: "scrape" });
  if ("response" in gate) return gate.response;
  const { admin } = gate;

  const body = await req.json().catch(() => ({} as any));
  const url = typeof body?.url === "string" ? body.url : "";
  const apply = body?.apply === true;
  const productId = typeof body?.productId === "string" && body.productId ? body.productId : null;
  const forceCreate = body?.forceCreate === true;

  if (!url.trim()) return NextResponse.json({ ok: false, error: "Paste a product page address first." }, { status: 400 });
  if (url.length > 2048) return NextResponse.json({ ok: false, error: "That web address is too long to be a real product page." }, { status: 400 });

  let found: Found;
  let finalUrl: string;
  const warnings: string[] = [];
  try {
    const page = await fetchPage(url);
    finalUrl = page.finalUrl;
    if (page.truncated) warnings.push("That page was very large, so we only read the first part of it — check the details below carefully.");
    found = extract(page.html, page.finalUrl);
  } catch (e: any) {
    if (e instanceof LookupError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    console.error("admin scrape fetch", e);
    return NextResponse.json({ ok: false, error: "Something went wrong reading that page. Try again in a moment." }, { status: 500 });
  }

  if (!found.title && !found.productCode && found.price === null) {
    return NextResponse.json({
      ok: false,
      error: "We read that page but couldn't find any product details on it. It may not be a product page — or the site hides its details from us. You can still add this one using Add product.",
    }, { status: 422 });
  }
  if (!found.productCode) warnings.push("No model number on that page — you'll need to type it in yourself.");
  if (found.price === null) warnings.push("No price on that page. Nothing will be priced automatically.");
  if (found.currency !== "GBP") {
    // Writing a euro figure into a pounds field puts a wrong price on the
    // storefront AND in the Google feed. Drop it; the owner types it himself.
    found.price = null;
    warnings.push(`That page prices in ${found.currency}, not pounds — the price was NOT saved. Enter it yourself.`);
  }

  let db: any;
  try { db = await getPrisma(); }
  catch { return NextResponse.json({ ok: false, error: "The database isn't reachable right now, so we can't check this against your products." }, { status: 503 }); }

  /* ───────────────────────────── preview (default): read only, write nothing */
  if (!apply) {
    let match: MatchRow | null = null;
    try { match = productId ? await db.product.findUnique({ where: { id: productId }, select: { id: true, title: true, productCode: true, brand: true, slug: true, priceNow: true } }) : await findMatch(db, found); }
    catch (e) { console.error("admin scrape match", e); warnings.push("We couldn't check this against your existing products just now."); }

    return NextResponse.json({
      ok: true, mode: "preview", url: finalUrl, found, warnings,
      matchedProductId: match?.id,
      match: match ? { id: match.id, title: match.title, productCode: match.productCode, brand: match.brand, slug: match.slug, priceNow: match.priceNow } : null,
    });
  }

  /* ─────────────────────────────────────────────────── apply: create/update */
  try {
    // forceCreate is the owner pressing "Add as a separate new product". Without
    // it the server re-matched and silently EDITED the existing row instead —
    // the opposite of what the button says.
    const target: MatchRow | null = productId
      ? await db.product.findUnique({ where: { id: productId }, select: { id: true, title: true, productCode: true, brand: true, slug: true, priceNow: true } })
      : forceCreate
        ? null
        : await findMatch(db, found);

    if (productId && !target) return NextResponse.json({ ok: false, error: "That product no longer exists — refresh the page and try again." }, { status: 404 });

    /* ── UPDATE ── */
    if (target) {
      const existing = await db.product.findUnique({ where: { id: target.id } });
      if (!existing) return NextResponse.json({ ok: false, error: "That product no longer exists — refresh the page and try again." }, { status: 404 });

      const locked = new Set<string>(Array.isArray(existing.adminOverrideFields) ? (existing.adminOverrideFields as any[]).map(String) : []);
      const data: Record<string, any> = {};
      const updated: { field: string; label: string; from: any; to: any }[] = [];
      const skipped: { field: string; label: string; reason: string }[] = [];

      for (const field of FILL_IF_EMPTY) {
        const value = foundValueFor(field, found);
        if (!value) continue;
        const current = existing[field];
        if (locked.has(field)) { skipped.push({ field, label: LABEL[field] || field, reason: "you set this yourself, so it was left alone" }); continue; }
        if (current !== null && current !== undefined && String(current).trim() !== "") {
          skipped.push({ field, label: LABEL[field] || field, reason: "already filled in, so it was left alone" });
          continue;
        }
        data[field] = (EDITABLE as readonly string[]).includes(field) ? coerce(field, value) : value;
        updated.push({ field, label: LABEL[field] || field, from: current ?? "", to: data[field] });
      }

      // Price is the one field a re-read is allowed to REPLACE — that is the point
      // of the tool. Unless the owner has set it himself, in which case it is
      // locked and we say so out loud rather than quietly overwriting him.
      if (found.price !== null) {
        if (locked.has("priceNow")) {
          skipped.push({ field: "priceNow", label: "price", reason: "you set this price yourself, so it was left alone" });
        } else if (existing.priceNow !== found.price) {
          data.priceNow = coerce("priceNow", found.price);
          reconcileSaving(data, { priceNow: existing.priceNow, priceWas: existing.priceWas });
          updated.push({ field: "priceNow", label: "price", from: existing.priceNow, to: data.priceNow });
        }
      }

      if (!existing.sourceUrl) data.sourceUrl = finalUrl;
      data.lastScrapedAt = new Date();

      if (!updated.length) {
        return NextResponse.json({
          ok: true, mode: "unchanged", productId: target.id, slug: target.slug, title: target.title,
          updated: [], skipped, warnings,
          message: "Nothing to change — everything on that page was either already filled in or set by you.",
        });
      }

      const saved = await db.product.update({ where: { id: target.id }, data });
      await writeAudit(db, {
        entityType: "product", entityId: saved.id, action: "admin:scrape-apply",
        changedFields: updated.map((u) => u.field),
        previousValue: Object.fromEntries(updated.map((u) => [u.field, u.from])),
        newValue: { ...Object.fromEntries(updated.map((u) => [u.field, u.to])), sourceUrl: finalUrl },
        changedBy: admin.email,
      });
      try { await syncProductToRag(db, saved.id); } catch { /* best effort */ }
      revalidateStorefront(["/", "/products"]);

      return NextResponse.json({
        ok: true, mode: "updated", productId: saved.id, slug: saved.slug, title: saved.title,
        updated, skipped, warnings,
        message: `Updated ${saved.title}. ${updated.length} thing${updated.length === 1 ? "" : "s"} filled in from that page${skipped.length ? `; ${skipped.length} left alone.` : "."}`,
      });
    }

    /* ── CREATE ── */
    if (!found.title) return NextResponse.json({ ok: false, error: "That page has no product name on it, so there's nothing to create. Use Add product instead." }, { status: 422 });
    if (!found.productCode) {
      return NextResponse.json({
        ok: false,
        error: "That page doesn't show a model number, and every product needs one — customers quote it on the phone. Use Add product and type it in.",
      }, { status: 422 });
    }

    const data: Record<string, any> = {
      title: coerce("title", found.title),
      brand: coerce("brand", found.brand) || "Unbranded",
      productCode: coerce("productCode", found.productCode),
      priceNow: found.price === null ? null : coerce("priceNow", found.price),
      availabilityNormalised: found.availabilityNormalised,
      availabilityRaw: found.availabilityRaw,
      shortDescription: found.description.slice(0, 300),
      descriptionText: found.description,
      mainImage: "",  // see safeImage(): a foreign URL would break next/image
    };
    reconcileSaving(data);

    const base = slugify(`${data.brand}-${data.productCode}`) || slugify(String(data.title));
    let slug = base || `product-${Date.now()}`;
    for (let i = 2; await db.product.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;

    const created = await db.product.create({
      data: {
        slug,
        title: data.title,
        brand: data.brand,
        productCode: data.productCode,
        category: "", subcategory: "",
        priceNow: data.priceNow ?? null,
        priceWas: null,
        saving: data.saving ?? null,
        availabilityNormalised: data.availabilityNormalised,
        availabilityRaw: data.availabilityRaw,
        warranty: "",
        shortDescription: data.shortDescription,
        descriptionText: data.descriptionText,
        mainImage: data.mainImage,
        gtin: found.gtin,
        // Nothing here was typed by the owner, so nothing is locked yet — the
        // next re-read is free to refresh it.
        adminOverrideFields: [],
        isVisible: true, featured: false,
        lastScrapedAt: new Date(),
        sourceUrl: finalUrl, oldUrl: "", currency: "GBP", descriptionHtml: "",
        breadcrumbs: [], specifications: [], features: [],
        galleryImages: data.mainImage ? [data.mainImage] : [],
        relatedProductCodes: [], serviceAddOns: [], energyLabelUrl: "", deliveryNotes: "",
        seoTitle: `${data.brand} ${data.title}`.trim().slice(0, 68),
        seoDescription: `${data.title}. Call 0208 864 5763 to confirm price, availability and delivery.`.slice(0, 300),
      },
    });

    await writeAudit(db, {
      entityType: "product", entityId: created.id, action: "admin:scrape-apply",
      changedFields: Object.keys(data),
      previousValue: {},
      newValue: { title: created.title, productCode: created.productCode, priceNow: created.priceNow, sourceUrl: finalUrl },
      changedBy: admin.email,
    });
    try { await syncProductToRag(db, created.id); } catch { /* best effort */ }
    try {
      await ensureBrand(db, created.brand);
      await recomputeCounts(db, { brands: [created.brand] });
    } catch { /* best effort */ }
    revalidateStorefront(["/", "/products"]);

    return NextResponse.json({
      ok: true, mode: "created", productId: created.id, slug: created.slug, title: created.title,
      updated: Object.keys(data).map((f) => ({ field: f, label: LABEL[f] || f, from: "", to: data[f] })),
      skipped: [], warnings,
      message: `Created ${created.title}. It has no category yet — open it and set one so it shows in the right department.`,
    }, { status: 201 });
  } catch (e: any) {
    if (e instanceof ValidationError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    console.error("admin scrape apply", e);
    return NextResponse.json({ ok: false, error: "We read the page, but saving it failed. Is the database running?" }, { status: 500 });
  }
}
