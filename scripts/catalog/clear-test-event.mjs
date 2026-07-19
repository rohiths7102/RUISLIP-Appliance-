/** One-off: remove the browser-click test event so analytics start truthful. */
const mod = await import("@prisma/client");
const db = new mod.PrismaClient();
try {
  const r = await db.trackedEvent.deleteMany({ where: { type: "call_click", productSlug: "lg-wt1210wwf" } });
  console.log(`removed ${r.count} test event(s); remaining:`, await db.trackedEvent.count());
} finally { await db.$disconnect(); }
