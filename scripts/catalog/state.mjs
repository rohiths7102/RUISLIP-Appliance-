/** Final state of the live database. */
const mod = await import("@prisma/client");
const db = new mod.PrismaClient();
try {
  const pad = (s) => String(s).padEnd(20);
  console.log("=== DATABASE ===");
  console.log("  " + pad("products") + (await db.product.count()));
  console.log("  " + pad("visible on shop") + (await db.product.count({ where: { isVisible: true } })));
  console.log("  " + pad("categories") + (await db.category.count()));
  console.log("  " + pad("brands") + (await db.brand.count()));
  console.log("  " + pad("audit log entries") + (await db.adminAuditLog.count()));
  console.log("  " + pad("enquiries") + (await db.enquiry.count()));
  const recent = await db.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 3, select: { action: true, entityId: true, changedBy: true, changedFields: true } });
  if (recent.length) {
    console.log("\n  most recent audit entries:");
    for (const r of recent) console.log(`    ${r.action.padEnd(7)} by ${r.changedBy}  fields=${JSON.stringify(r.changedFields)}`);
  }
} finally { await db.$disconnect(); }
