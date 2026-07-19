/** Print the newest tracked events (debug helper). */
const mod = await import("@prisma/client");
const db = new mod.PrismaClient();
try {
  const rows = await db.trackedEvent.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
  if (!rows.length) console.log("NO EVENTS");
  for (const e of rows) console.log(`${e.type}  path=${e.path}  product=${e.productSlug}  pc=${e.postcode}  ${e.createdAt.toISOString()}`);
} finally { await db.$disconnect(); }
