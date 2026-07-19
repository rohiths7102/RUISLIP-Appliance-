export async function getPrisma(): Promise<any> {
  const mod: any = await import("@prisma/client");
  const g = globalThis as any;
  if (!g.__prisma) g.__prisma = new mod.PrismaClient();
  return g.__prisma;
}
