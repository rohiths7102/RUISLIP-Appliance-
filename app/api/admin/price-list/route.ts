import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { parsePriceList, planPriceList, applyPriceList } from "@/lib/price-list";
import { revalidateStorefront } from "@/lib/revalidate";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST multipart { file: the Euronics price list (.xlsx or .csv), apply?: "1" }
 * Without apply: what would change (nothing written). With apply: the same
 * file again, and every B2C price goes on the website — see lib/price-list.ts.
 * Stateless on purpose: the file is re-read on apply, so what is applied is
 * exactly what the owner uploaded, never a cached plan from another tab.
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 10, windowMs: 60_000, bucket: "price-list" });
  if ("response" in gate) return gate.response;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose the price list file first." }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "That file is over 8 MB — is it the Euronics price list?" }, { status: 413 });

  let rows;
  try { rows = parsePriceList(file.name, new Uint8Array(await file.arrayBuffer())); }
  catch (e) { return NextResponse.json({ error: (e as Error).message || "Couldn't read that file." }, { status: 400 }); }
  if (!rows.length) return NextResponse.json({ error: "No model numbers with prices in that file." }, { status: 400 });

  const db = await getPrisma();
  const plan = await planPriceList(db, rows);
  const summary = {
    file: file.name, rows: plan.rows, priced: plan.priced, matched: plan.matched, notInCatalogue: plan.notInCatalogue,
    unchanged: plan.unchanged, hidden: plan.hidden, callForPrice: plan.callForPrice, notApproved: plan.notApproved,
    changeCount: plan.changes.length,
    up: plan.changes.filter((c) => c.from !== null && c.to > c.from).length,
    down: plan.changes.filter((c) => c.from !== null && c.to < c.from).length,
    added: plan.changes.filter((c) => c.from === null).length,
  };
  if (form?.get("apply") !== "1") {
    return NextResponse.json({ applied: false, ...summary, changes: plan.changes.slice(0, 300).map(({ locks: _locks, id: _id, ...c }) => c) });
  }
  await applyPriceList(db, plan, { file: file.name, by: gate.admin.email });
  if (plan.changes.length) revalidateStorefront(["/", "/products"]);
  return NextResponse.json({ applied: true, ...summary });
}
