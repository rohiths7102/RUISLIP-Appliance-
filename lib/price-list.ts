import { unzipSync, strFromU8 } from "fflate";
import { isPoaProduct, poaNamesFromDb } from "@/lib/poa";

/**
 * Sachin's Euronics (CIH) price list, uploaded in Admin → Price watch. Its B2C
 * price is the customer price, so it goes straight onto the website — the owner
 * asked for exactly that (24 Sept 2026: "upload and the price changes
 * automatically"). Reads the workbook he is emailed (.xlsx, the "Full Data"
 * tab) or a CSV with a model column and a price column.
 *
 * Columns are found by their HEADER, never their position: CIH re-ordered the
 * sheet in September 2026, and a reader keyed to column letters would have taken
 * the trade (B2B) price for the retail one.
 */

export type ListRow = { model: string; price: number | null; stockType: string; b2b: number | null; ean: string; approved: boolean | null };

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const money = (s: string | undefined) => {
  const n = parseFloat(String(s ?? "").replace(/[£,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

// ---- reading ----------------------------------------------------------------------

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]);
const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const texts = (xml: string) => unxml([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

/** The "Full Data" sheet (else the first) as rows of cell text. An .xlsx is a zip of XML. */
function readXlsx(bytes: Uint8Array): string[][] {
  // Only the parts needed, and none implausibly large (a zip bomb stops here).
  const files = unzipSync(bytes, { filter: (f) => f.originalSize < 80_000_000 && /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name) });
  const text = (n: string) => (files[n] ? strFromU8(files[n]) : "");
  const sheets = [...text("xl/workbook.xml").matchAll(/<sheet\b[^>]*?\bname="([^"]*)"[^>]*?\br:id="([^"]*)"/g)];
  const pick = sheets.find((m) => unxml(m[1]).trim().toLowerCase() === "full data") || sheets[0];
  if (!pick) throw new Error("That workbook has no sheets.");
  const rel = [...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${pick[2]}"`)) || "";
  const target = ((rel.match(/Target="([^"]+)"/) || [])[1] || "").replace(/^\/?(xl\/)?/, "");
  const sheet = text(`xl/${target}`);
  if (!sheet) throw new Error("Couldn't read the sheet in that workbook.");
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    for (const c of (r[1] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (c[1].match(/\br="([A-Z]+)\d+"/) || [])[1];
      if (!ref) continue;
      const type = (c[1].match(/\bt="([^"]+)"/) || [])[1];
      const v = (c[2]?.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      row[colIndex(ref)] = (type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? texts(c[2] || "") : unxml(v ?? "")).trim();
    }
    rows.push(row);
  }
  return rows;
}

function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (s[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

// Each field's accepted headers, in order of preference. "B2C Agency Price" is
// the price to show; "Current B2C Price" and "Previous B2C Price" are not.
const HEADERS: Record<string, RegExp[]> = {
  model: [/^model number$/, /^model$/, /^product code$/, /^model code$/, /^code$/, /^sku$/],
  price: [/^b2c agency price$/, /^b2c price$/, /^customer price$/, /^retail price$/, /^selling price$/, /^price$/],
  future: [/^future b2c agency price$/, /^future b2c price$/],
  futureStart: [/^future b2c agency price start date$/, /^future b2c price start date$/],
  stock: [/^stock type/],
  b2b: [/^b2b price$/],
  ean: [/^ean$/, /^barcode$/, /^gtin$/],
  approved: [/^b2c approved$/],
};

/** Days since 1899-12-30 (Excel's calendar) for a cell: a serial number, or dd/mm/yyyy, or yyyy-mm-dd. */
const serialOf = (s: string | undefined): number | null => {
  const v = String(s ?? "").trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.floor(Number(v));
  const uk = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/), iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = uk ? Date.UTC(+uk[3], +uk[2] - 1, +uk[1]) : iso ? Date.UTC(+iso[1], +iso[2] - 1, +iso[3]) : NaN;
  return Number.isFinite(d) ? Math.round((d - Date.UTC(1899, 11, 30)) / 86_400_000) : null;
};
/** Today's date in the UK, on Excel's calendar. */
export const ukTodaySerial = (now = new Date()) => {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
};

/** The list's rows, each with the customer price that applies TODAY (a future price whose date has come wins). */
export function parsePriceList(filename: string, bytes: Uint8Array, today = ukTodaySerial()): ListRow[] {
  const table = /\.xlsx$/i.test(filename) ? readXlsx(bytes)
    : /\.csv$/i.test(filename) ? readCsv(strFromU8(bytes))
      : (() => { throw new Error("Upload the price list as .xlsx (the emailed workbook) or .csv."); })();
  const find = (header: string[], field: string) => {
    const h = header.map((x) => String(x ?? "").trim().toLowerCase());
    for (const re of HEADERS[field]) { const i = h.findIndex((x) => re.test(x)); if (i >= 0) return i; }
    return -1;
  };
  const at = table.slice(0, 10).findIndex((r) => find(r, "model") >= 0 && find(r, "price") >= 0);
  if (at < 0) throw new Error("Couldn't find a model number column and a price column. Is this the Euronics price list?");
  const col = Object.fromEntries(Object.keys(HEADERS).map((k) => [k, find(table[at], k)]));
  const out = new Map<string, ListRow>();
  for (const r of table.slice(at + 1)) {
    const model = String(r[col.model] ?? "").trim();
    if (!model || out.has(norm(model))) continue;
    const future = col.future >= 0 ? money(r[col.future]) : null;
    const start = col.futureStart >= 0 ? serialOf(r[col.futureStart]) : null;
    const approved = col.approved >= 0 ? String(r[col.approved] ?? "").trim().toUpperCase() : "";
    out.set(norm(model), {
      model,
      price: future !== null && start !== null && start <= today ? future : money(r[col.price]),
      stockType: col.stock >= 0 ? String(r[col.stock] ?? "").trim().toUpperCase() : "",
      b2b: col.b2b >= 0 ? money(r[col.b2b]) : null,
      ean: col.ean >= 0 ? String(r[col.ean] ?? "").replace(/[^0-9]/g, "") : "",
      approved: approved === "YES" ? true : approved === "NO" ? false : null,
    });
  }
  return [...out.values()];
}

// ---- what it would change ----------------------------------------------------------

export type PriceChange = { id: string; slug: string; code: string; title: string; from: number | null; to: number; locks: string[] };
export type ListPlan = {
  rows: number; priced: number; matched: number; notInCatalogue: number;
  unchanged: number; hidden: number; callForPrice: number; notApproved: number;
  changes: PriceChange[];
  enrich: { id: string; data: Record<string, unknown> }[];
  observe: { productId: string; price: number }[];
};

export async function planPriceList(db: any, rows: ListRow[]): Promise<ListPlan> {
  const [products, poa] = await Promise.all([
    db.product.findMany({ select: { id: true, slug: true, productCode: true, title: true, priceNow: true, isVisible: true, category: true, subcategory: true, brand: true, gtin: true, agencyStock: true, costPrice: true, adminOverrideFields: true } }),
    poaNamesFromDb(db),
  ]);
  const byCode = new Map<string, any[]>(), byEan = new Map<string, any[]>();
  for (const p of products) {
    byCode.set(norm(p.productCode), [...(byCode.get(norm(p.productCode)) || []), p]);
    if (p.gtin) byEan.set(p.gtin, [...(byEan.get(p.gtin) || []), p]);
  }
  const plan: ListPlan = { rows: rows.length, priced: 0, matched: 0, notInCatalogue: 0, unchanged: 0, hidden: 0, callForPrice: 0, notApproved: 0, changes: [], enrich: [], observe: [] };
  for (const r of rows) {
    if (r.price !== null) plan.priced++;
    const matches = byCode.get(norm(r.model)) || (/^\d{8,14}$/.test(r.ean) && byEan.get(r.ean)) || [];
    if (!matches.length) { plan.notInCatalogue++; continue; }
    plan.matched++;
    if (r.approved === false) plan.notApproved++;
    for (const p of matches) {
      // As the command-line importer: the agency flag, the EAN, and for CENTRAL
      // stock the trade price as cost (agency stock is the group's, never ours).
      const agency = r.stockType ? r.stockType.includes("AGENCY") : null;
      const data: Record<string, unknown> = {};
      if (agency !== null && p.agencyStock !== agency) data.agencyStock = agency;
      if (agency === true && p.costPrice !== null) data.costPrice = null;
      if (agency === false && r.b2b !== null && p.costPrice !== r.b2b) data.costPrice = r.b2b;
      if (/^\d{8,14}$/.test(r.ean) && p.gtin !== r.ean) data.gtin = r.ean;
      if (Object.keys(data).length) plan.enrich.push({ id: p.id, data });
      if (r.price === null) continue;
      plan.observe.push({ productId: p.id, price: r.price });
      if (!p.isVisible) { plan.hidden++; continue; }
      if (isPoaProduct(poa, p)) { plan.callForPrice++; continue; }
      if (p.priceNow !== null && Math.abs(p.priceNow - r.price) < 0.01) { plan.unchanged++; continue; }
      plan.changes.push({ id: p.id, slug: p.slug, code: p.productCode, title: p.title, from: p.priceNow, to: r.price, locks: Array.isArray(p.adminOverrideFields) ? p.adminOverrideFields : [] });
    }
  }
  plan.changes.sort((a, b) => Math.abs(b.to - (b.from ?? 0)) - Math.abs(a.to - (a.from ?? 0)));
  return plan;
}

// ---- applying it --------------------------------------------------------------------

/** Every price change, the flags/EANs, and a "cih" read per product (so the nightly
 *  website sync leaves a fresh list price alone for two days). Audit row per change. */
export async function applyPriceList(db: any, plan: ListPlan, meta: { file: string; by: string }): Promise<void> {
  const batch = async (ops: any[]) => { for (let i = 0; i < ops.length; i += 100) await db.$transaction(ops.slice(i, i + 100)); };
  await batch(plan.enrich.map((e) => db.product.update({ where: { id: e.id }, data: e.data })));
  const now = new Date();
  for (let i = 0; i < plan.observe.length; i += 500) {
    await db.priceObservation.createMany({ data: plan.observe.slice(i, i + 500).map((o) => ({
      productId: o.productId, sourceId: "cih", price: o.price, deliveryCost: 0, inStock: null, includesVat: true, sourceUrl: "",
      matchConfidence: 1, status: "ok", note: `Price list upload: ${meta.file}`.slice(0, 190), observedAt: now,
    })) });
  }
  await batch(plan.changes.map((c) => db.product.update({ where: { id: c.id }, data: {
    priceNow: c.to, priceWas: null, saving: null, adminOverrideFields: c.locks.filter((f) => f !== "priceNow"),
  } })));
  await db.adminAuditLog.createMany({ data: [
    ...plan.changes.map((c) => ({
      entityType: "product", entityId: c.id, action: "price-list:apply", changedFields: ["priceNow"],
      previousValue: { priceNow: c.from }, newValue: { priceNow: c.to, sourceId: "cih", file: meta.file }, changedBy: meta.by,
    })),
    { entityType: "price-list", entityId: meta.file.slice(0, 120), action: "price-list:upload", changedFields: ["priceNow"],
      previousValue: {}, newValue: { changed: plan.changes.length, unchanged: plan.unchanged, matched: plan.matched, notInCatalogue: plan.notInCatalogue }, changedBy: meta.by },
  ] });
  if (plan.observe.length) await db.priceSource.update({ where: { id: "cih" }, data: { lastRunAt: now, lastRunStatus: `upload ${meta.file}: ${plan.changes.length} changed`.slice(0, 200) } }).catch(() => {});
}
