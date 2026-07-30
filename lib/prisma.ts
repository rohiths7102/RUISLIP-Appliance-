import { ensureDatabaseUrl } from "./db-url";

export async function getPrisma(): Promise<any> {
  // The host may publish the connection string under another name (Vercel+Supabase
  // gives DATABASE_POSTGRES_PRISMA_URL, etc.) — normalise before constructing.
  ensureDatabaseUrl();
  const mod: any = await import("@prisma/client");
  const g = globalThis as any;
  if (!g.__prisma) g.__prisma = new mod.PrismaClient();
  return g.__prisma;
}
