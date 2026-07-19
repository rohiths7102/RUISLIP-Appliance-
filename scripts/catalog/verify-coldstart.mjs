/**
 * Cold-start race check.
 *
 * getDb() probes the database on first use. If concurrent requests arriving during
 * that probe are told "no database", they silently serve the bundled JSON catalogue
 * instead — visitors get a stale shop and admin edits vanish. Fire a burst of
 * simultaneous requests at a freshly-started server and assert every one of them
 * saw the database.
 *
 * Usage: node scripts/catalog/verify-coldstart.mjs [baseUrl] [dbOnlySlug]
 */
const BASE = process.argv[2] || "http://localhost:3005";
const SLUG = process.argv[3];
if (!SLUG) { console.error("need a slug that exists ONLY in the database"); process.exit(2); }

const BURST = 25;
const results = await Promise.all(
  Array.from({ length: BURST }, () => fetch(`${BASE}/products/${SLUG}`).then((r) => r.status).catch(() => 0))
);
const ok = results.filter((s) => s === 200).length;
const notFound = results.filter((s) => s === 404).length;

console.log(`burst of ${BURST} concurrent requests for a DB-only product:`);
console.log(`  200 (read the database) : ${ok}`);
console.log(`  404 (fell back to JSON) : ${notFound}`);
console.log(`  other                   : ${results.length - ok - notFound}`);

if (ok !== BURST) { console.log("\nFAIL — some requests fell back to the stale catalogue"); process.exit(1); }
console.log("\nPASS — every concurrent request read the database");
