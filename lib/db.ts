import { PrismaClient } from "@prisma/client";
import { ensureDatabaseUrl } from "./db-url";

// Must run before the client is constructed — the host may name the connection
// string something other than DATABASE_URL (see lib/db-url.ts).
ensureDatabaseUrl();

const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = db;
