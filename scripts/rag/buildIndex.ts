import { db } from "../../lib/db.js";
import { buildIndex } from "../../lib/rag/index.js";
const r = await buildIndex(db);
console.log(`RAG index built: ${r.indexed} documents (${r.embedded ? "with vector embeddings" : "lexical mode — no embeddings provider set"}).`);
await db.$disconnect();
