import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { syncProductToRag } from "@/lib/rag/index";
import { parseCsv } from "@/lib/csv";
import { AVAILABILITY, SCRAPE_OWNED } from "@/lib/admin-product";
import { recomputeCounts, ensureBrand } from "@/lib/counts";
import { revalidateStorefront } from "@/lib/revalidate";
export const dynamic = "force-dynamic";

/**
 * CSV import — the safe way: `mode:"preview"` returns the exact diff (nothing
 * written), `mode:"apply"` performs it. Same spreadsheet format the export
 * produces, so the owner's loop is: Export → edit prices in Excel → Import.
 *
 * Rows are matched by `slug` (unique) and fall back to `productCode` only when
 * that code is unambiguous — 198 BSH part numbers exist under both Bosch and
 * Neff, so productCode alone cannot address a row safely.
 */
const UPDATABLE = ["title", "brand", "category", "subcategory", "priceNow", "priceWas", "availabilityNormalised", "warranty", "isVisible", "featured"] as const;
const NUM = new Set(["priceNow", "priceWas"]);
const BOOL = new Set(["isVisible", "featured"]);
const MAX_ROWS = 5000;
const MAX_BYTES = 2 * 1024 * 1024;

const parseBool = (s: string) => /^(true|1|yes)$/i.test(s) ? true : /^(false|0|no)$/i.test(s) ? false : null;

export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 20, windowMs: 60_000 });
  if ("response" in gate) return gate.response;
  const admin = gate.admin;
  const body = await req.json().catch(() => ({}));
  const mode = body.mode === "apply" ? "apply" : "preview";
  const csv = String(body.csv || "");
  if (!csv.trim()) return NextResponse.json({ error: "Empty file" }, { status: 400 });
  if (csv.length > MAX_BYTES) return NextResponse.json({ error: "File too large (max 2MB)" }, { status: 413 });

  const grid = parseCsv(csv);
  if (grid.length < 2) return NextResponse.json({ error: "No data rows found under the header" }, { status: 400 });
  if (grid.length - 1 > MAX_ROWS) return NextResponse.json({ error: `Too many rows (max ${MAX_ROWS})` }, { status: 400 });

  const header = grid[0].map((h) => h.trim());
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const slugCol = col("slug");
  const codeCol = col("productCode");
  if (slugCol === -1 && codeCol === -1)
    return NextResponse.json({ error: 'The CSV needs a "slug" or "productCode" column (use the exported file as the template)' }, { status: 400 });

  try {
    const db = await getPrisma();
    const all = await db.product.findMany({ select: { id: true, slug: true, productCode: true, title: true, brand: true, category: true, subcategory: true, priceNow: true, priceWas: true, availabilityNormalised: true, warranty: true, isVisible: true, featured: true, adminOverrideFields: true } });
    const bySlug = new Map(all.map((p: any) => [p.slug, p]));
    const byCode = new Map<string, any[]>();
    for (const p of all) {
      const k = p.productCode.toUpperCase();
      if (!byCode.has(k)) byCode.set(k, []);
      byCode.get(k)!.push(p);
    }

    const errors: string[] = [];
    const changes: { id: string; slug: string; code: string; data: Record<string, any>; fields: { field: string; from: any; to: any }[] }[] = [];
    const creates: { data: Record<string, any>; code: string }[] = [];
    let unchanged = 0;

    for (let r = 1; r < grid.length; r++) {
      const rowNo = r + 1;
      const cells = grid[r];
      const get = (name: string) => { const i = col(name); return i === -1 ? undefined : (cells[i] ?? "").trim(); };

      // locate the product
      let target: any = null;
      const slug = slugCol !== -1 ? (cells[slugCol] || "").trim() : "";
      const code = codeCol !== -1 ? (cells[codeCol] || "").trim() : "";
      if (slug) target = bySlug.get(slug) || null;
      if (!target && code) {
        const matches = byCode.get(code.toUpperCase()) || [];
        if (matches.length === 1) target = matches[0];
        else if (matches.length > 1) { errors.push(`row ${rowNo}: code ${code} matches ${matches.length} products (Bosch/Neff twin) — include the slug column`); continue; }
      }

      // collect updates
      const data: Record<string, any> = {};
      const fields: { field: string; from: any; to: any }[] = [];
      let bad = false;
      for (const k of UPDATABLE) {
        const raw = get(k);
        if (raw === undefined) continue;
        let v: any = raw;
        if (NUM.has(k)) {
          if (raw === "") v = null;
          else { v = Number(raw); if (!Number.isFinite(v) || v < 0) { errors.push(`row ${rowNo}: ${k} "${raw}" is not a valid price`); bad = true; break; } }
        } else if (BOOL.has(k)) {
          if (raw === "") continue;
          const b = parseBool(raw);
          if (b === null) { errors.push(`row ${rowNo}: ${k} "${raw}" must be true/false`); bad = true; break; }
          v = b;
        } else if (k === "availabilityNormalised") {
          if (raw === "") continue;
          if (!AVAILABILITY.includes(raw)) { errors.push(`row ${rowNo}: availability "${raw}" — use one of ${AVAILABILITY.join("/")}`); bad = true; break; }
        }
        if (target ? v !== (target as any)[k] : raw !== "") { data[k] = v; if (target) fields.push({ field: k, from: (target as any)[k], to: v }); }
      }
      if (bad) continue;

      if (target) {
        if (!fields.length) { unchanged++; continue; }
        changes.push({ id: target.id, slug: target.slug, code: target.productCode, data, fields });
      } else {
        // brand-new product from the spreadsheet
        if (!data.title || !code) { errors.push(`row ${rowNo}: unknown product — a new row needs productCode and title`); continue; }
        creates.push({ data: { ...data, productCode: code }, code });
      }
    }

    const summary = {
      mode,
      rows: grid.length - 1,
      updates: changes.length,
      creates: creates.length,
      unchanged,
      errors: errors.slice(0, 12),
      errorCount: errors.length,
      sample: changes.slice(0, 10).map((c) => ({ code: c.code, fields: c.fields })),
    };
    if (mode === "preview") return NextResponse.json(summary);
    if (errors.length) return NextResponse.json({ ...summary, error: "Fix the errors above, then re-import — nothing was written." }, { status: 400 });

    /* ---- apply ---- */
    const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    for (const c of changes) {
      const overrides = new Set<string>(((bySlug.get(c.slug) as any)?.adminOverrideFields as string[]) || []);
      for (const f of Object.keys(c.data)) if (SCRAPE_OWNED.has(f)) overrides.add(f);
      await db.product.update({ where: { id: c.id }, data: { ...c.data, adminOverrideFields: [...overrides], lastUpdatedByAdmin: new Date() } });
      try { await syncProductToRag(db, c.id); } catch {}
    }
    for (const c of creates) {
      const base = slugify(`${c.data.brand || "product"}-${c.code}`);
      let slug = base;
      for (let i = 2; await db.product.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
      const created = await db.product.create({ data: {
        slug, title: c.data.title, brand: c.data.brand || "Unbranded", productCode: c.code,
        category: c.data.category || "", subcategory: c.data.subcategory || "",
        priceNow: c.data.priceNow ?? null, priceWas: c.data.priceWas ?? null, saving: null,
        availabilityNormalised: c.data.availabilityNormalised || "call_to_confirm", availabilityRaw: "",
        warranty: c.data.warranty || "", isVisible: c.data.isVisible ?? true, featured: c.data.featured ?? false,
        shortDescription: "", descriptionHtml: "", descriptionText: "", sourceUrl: "", oldUrl: "", currency: "GBP",
        breadcrumbs: [], specifications: [], features: [], galleryImages: [], relatedProductCodes: [], serviceAddOns: [],
        energyLabelUrl: "", mainImage: "", deliveryNotes: "", seoTitle: "", seoDescription: "",
        adminOverrideFields: Object.keys(c.data), lastUpdatedByAdmin: new Date(),
      }});
      try { await syncProductToRag(db, created.id); } catch {}
    }
    // New brands get their pages; every count the storefront shows gets retrued.
    try {
      const touched = [...changes.map((c) => c.data), ...creates.map((c) => c.data)];
      for (const d of creates.map((c) => c.data)) if (d.brand) await ensureBrand(db, d.brand);
      const affected = await db.product.findMany({ where: { id: { in: changes.map((c) => c.id) } }, select: { brand: true, category: true, subcategory: true } });
      await recomputeCounts(db, {
        brands: [...touched.map((d) => d.brand), ...affected.map((a: any) => a.brand)],
        categories: [...touched.flatMap((d) => [d.category, d.subcategory]), ...affected.flatMap((a: any) => [a.category, a.subcategory])],
      });
    } catch { /* counts are best effort */ }
    await writeAudit(db, {
      entityType: "product", entityId: `csv-import:${changes.length + creates.length}`, action: "csv-import",
      changedFields: ["csv"], previousValue: {}, newValue: { updates: changes.length, creates: creates.length, unchanged },
      changedBy: admin.email,
    });
    revalidateStorefront();
    return NextResponse.json({ ...summary, applied: true });
  } catch (e) {
    console.error("csv import", e);
    return NextResponse.json({ error: "Import failed. Is the database running?" }, { status: 500 });
  }
}
