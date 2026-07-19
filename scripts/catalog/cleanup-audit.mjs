/** Remove anything the audit scripts created: probe products + test uploads. */
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const mod = await import("@prisma/client");
const db = new mod.PrismaClient();
try {
  const junk = await db.product.findMany({
    where: { OR: [{ productCode: { startsWith: "AUDIT-" } }, { productCode: { startsWith: "COLDSTART" } }] },
    select: { id: true, productCode: true },
  });
  for (const p of junk) {
    await db.rAGDocument.deleteMany({ where: { sourceType: "product", sourceId: p.id } }).catch(() => {});
    await db.product.delete({ where: { id: p.id } });
    console.log("removed probe product", p.productCode);
  }
  console.log("products in DB:", await db.product.count());
} finally { await db.$disconnect(); }

const dir = join(process.cwd(), "public", "uploads");
try {
  const files = await readdir(dir);
  for (const f of files) await unlink(join(dir, f));
  console.log(`removed ${files.length} test upload(s)`);
} catch { console.log("no uploads to clean"); }
