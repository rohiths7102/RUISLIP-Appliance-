import { db } from "../../lib/db.js";
import { syncProductToRag } from "../../lib/rag/index.js";
const id = process.argv[2];
if (!id) { console.error("Usage: tsx scripts/rag/syncProductToRag.ts <productId>"); process.exit(1); }
console.log(await syncProductToRag(db, id) ? "Reindexed product " + id : "Product not found: " + id);
await db.$disconnect();
