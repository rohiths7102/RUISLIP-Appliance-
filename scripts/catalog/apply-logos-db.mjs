/** Push data/brand-logos.json into the live Brand table (storefront reads the DB). */
import { readFileSync } from "node:fs";
const logos = JSON.parse(readFileSync("data/brand-logos.json", "utf8"));
const mod = await import("@prisma/client");
const db = new mod.PrismaClient();
try {
  let n = 0;
  for (const [slug, logo] of Object.entries(logos)) {
    const r = await db.brand.updateMany({ where: { slug }, data: { logo, requiresLogoPermissionReview: false } });
    n += r.count;
  }
  console.log(`updated ${n} brand rows with logos`);
  const withLogo = await db.brand.count({ where: { NOT: { logo: "" } } });
  console.log(`brands with logo in DB: ${withLogo} / ${await db.brand.count()}`);
} finally { await db.$disconnect(); }
