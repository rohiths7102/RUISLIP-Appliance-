/** Slice 5/7 — import scraped data/*.json into the DB. Delegates to lib/importer.ts
 * so the admin Sync screen and this CLI share identical logic. Run: npm run db:import */
import { db } from "../../lib/db.js";
import { applyImport } from "../../lib/importer.js";
async function main() {
  const r = await applyImport(db, "scrape-cli");
  console.log(`Import complete: created=${r.created} updated=${r.updated} failed=${r.failed} removed(not in scrape)=${r.removed}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
