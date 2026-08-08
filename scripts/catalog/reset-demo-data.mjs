/**
 * Reset the TRANSACTIONAL data to a clean, honest starting state for the demo —
 * without touching the catalogue. Removes:
 *   - all enquiries
 *   - all tracked analytics events
 *   - all admin audit-log entries
 *   - any leftover AUDIT-* / COLDSTART scratch products + test uploads
 *
 * Keeps products, categories, brands and business settings intact. After this the
 * dashboard shows real zeros, so the first real customer call/enquiry is genuine.
 *
 * GUARDED, because this is the one script that deletes records the app itself
 * deliberately refuses to delete: enquiries ARE the sales pipeline, and the audit
 * log is the only record of who changed what. It runs against whatever
 * DATABASE_URL is in the environment and it sits beside routine ops scripts, so
 * one stray run against the live database after go-live would destroy every real
 * customer enquiry with nothing to restore from. Hence:
 *
 *   node scripts/catalog/reset-demo-data.mjs                       # dry run — counts only
 *   node scripts/catalog/reset-demo-data.mjs --yes-wipe-enquiries  # local database
 *   ...  --yes-wipe-enquiries --yes-remote-database                # anything else
 *
 * A dry run is the default: no flag, no deletion. "Local" means sqlite (file:) or
 * a database on localhost; a hosted URL needs the second flag typed out in full
 * as well, so it can never be reached by recalling the first from shell history.
 * An unreadable DATABASE_URL counts as remote — a guard that cannot prove where
 * it is pointing must not pass.
 */
import { readdir, unlink } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// .env.local / .env, same precedence as Next — plain `node` doesn't load them and
// the guard must read the SAME DATABASE_URL that Prisma is about to connect with.
for (const f of [".env.local", ".env"]) {
  const fp = join(process.cwd(), f);
  if (!existsSync(fp)) continue;
  for (const line of readFileSync(fp, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const WIPE = process.argv.includes("--yes-wipe-enquiries");
const ALLOW_REMOTE = process.argv.includes("--yes-remote-database");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const dbUrl = process.env.DATABASE_URL || "";
const isSqlite = dbUrl.startsWith("file:");
const parsed = (() => { try { return new URL(dbUrl); } catch { return null; } })();
const isLocal = isSqlite || (!!parsed && LOCAL_HOSTS.has(parsed.hostname));
// The URL carries the database password — only ever show the file or the host.
const dbLabel = isSqlite ? dbUrl : parsed?.host || "(no readable DATABASE_URL)";

const mod = await import("@prisma/client");
const db = new mod.PrismaClient();
try {
  const SCRATCH = { OR: [{ productCode: { startsWith: "AUDIT-" } }, { productCode: { startsWith: "COLDSTART" } }] };
  const before = {
    enquiries: await db.enquiry.count(),
    events: await db.trackedEvent.count(),
    audit: await db.adminAuditLog.count(),
    scratch: await db.product.count({ where: SCRATCH }),
  };

  console.log(`database: ${dbLabel}  ${isLocal ? "(local)" : "(NOT local)"}`);
  console.log("this reset destroys:");
  console.log(`  enquiries              : ${before.enquiries}`);
  console.log(`  tracked events         : ${before.events}`);
  console.log(`  audit entries          : ${before.audit}`);
  console.log(`  scratch products       : ${before.scratch}  (AUDIT-* / COLDSTART only)`);
  console.log(`  plus data/enquiries.jsonl and everything in public/uploads`);
  console.log(`and keeps: ${await db.product.count()} products, ${await db.category.count()} categories, ${await db.brand.count()} brands`);

  if (!WIPE) {
    console.log("\nDry run — nothing was deleted. Add --yes-wipe-enquiries to actually reset.");
  } else if (!isLocal && !ALLOW_REMOTE) {
    console.error("\nRefusing to run: DATABASE_URL is not a local database.");
    console.error("Enquiries are the owner's sales pipeline and the audit log is the record of");
    console.error("who changed what — neither is recoverable once deleted. If you really do mean");
    console.error("this database, re-run with --yes-remote-database as well.");
    process.exitCode = 1;
  } else {
    // scratch products first (also drop their RAG docs)
    const scratch = await db.product.findMany({ where: SCRATCH, select: { id: true, productCode: true } });
    for (const p of scratch) {
      // Product RAG docs are keyed by productCode, not DB id.
      await db.rAGDocument.deleteMany({ where: { sourceType: "product", sourceId: p.productCode } }).catch(() => {});
      await db.product.delete({ where: { id: p.id } });
    }
    // Sweep any doc orphaned by the old id-keyed cleanup (scratch codes only).
    await db.rAGDocument.deleteMany({ where: { sourceType: "product", OR: [{ sourceId: { startsWith: "AUDIT-" } }, { sourceId: { startsWith: "COLDSTART" } }] } }).catch(() => {});

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

    console.log("\nReset to clean demo state:");
    console.log(`  enquiries removed      : ${e.count}  (was ${before.enquiries})`);
    console.log(`  tracked events removed : ${t.count}  (was ${before.events})`);
    console.log(`  audit entries removed  : ${a.count}  (was ${before.audit})`);
    console.log(`  scratch products removed: ${scratch.length}  (was ${before.scratch})`);
    console.log(`  products kept          : ${await db.product.count()}`);
    console.log(`  categories / brands    : ${await db.category.count()} / ${await db.brand.count()}`);
  }
} finally { await db.$disconnect(); }
