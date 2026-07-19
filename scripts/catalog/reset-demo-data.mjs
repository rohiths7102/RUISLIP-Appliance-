/**
 * Reset the TRANSACTIONAL data to a clean, honest starting state for the demo —
 * without touching the catalogue. Removes:
 *   - all enquiries (currently only test submissions: "RL Test", "Audit Customer", …)
 *   - all tracked analytics events (all synthetic, from verification runs)
 *   - all admin audit-log entries (all from development/testing)
 *   - any leftover AUDIT-* / COLDSTART scratch products + test uploads
 *
 * Keeps products, categories, brands and business settings intact. After this the
 * dashboard shows real zeros, so the first real customer call/enquiry is genuine.
 */
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const mod = await import("@prisma/client");
const db = new mod.PrismaClient();
try {
  const before = {
    enquiries: await db.enquiry.count(),
    events: await db.trackedEvent.count(),
    audit: await db.adminAuditLog.count(),
    scratch: await db.product.count({ where: { OR: [{ productCode: { startsWith: "AUDIT-" } }, { productCode: { startsWith: "COLDSTART" } }] } }),
  };

  // scratch products first (also drop their RAG docs)
  const scratch = await db.product.findMany({ where: { OR: [{ productCode: { startsWith: "AUDIT-" } }, { productCode: { startsWith: "COLDSTART" } }] }, select: { id: true } });
  for (const p of scratch) {
    await db.rAGDocument.deleteMany({ where: { sourceType: "product", sourceId: p.id } }).catch(() => {});
    await db.product.delete({ where: { id: p.id } });
  }

  const e = await db.enquiry.deleteMany({});
  const t = await db.trackedEvent.deleteMany({});
  const a = await db.adminAuditLog.deleteMany({});

  // stale file fallback for enquiries (when DB was down during a test)
  try { await unlink(join(process.cwd(), "data", "enquiries.jsonl")); } catch {}
  // test uploads
  try {
    const dir = join(process.cwd(), "public", "uploads");
    for (const f of await readdir(dir)) await unlink(join(dir, f));
  } catch {}

  console.log("Reset to clean demo state:");
  console.log(`  enquiries removed      : ${e.count}  (was ${before.enquiries})`);
  console.log(`  tracked events removed : ${t.count}  (was ${before.events})`);
  console.log(`  audit entries removed  : ${a.count}  (was ${before.audit})`);
  console.log(`  scratch products removed: ${scratch.length}  (was ${before.scratch})`);
  console.log(`  products kept          : ${await db.product.count()}`);
  console.log(`  categories / brands    : ${await db.category.count()} / ${await db.brand.count()}`);
} finally { await db.$disconnect(); }
