/**
 * Resolve the Postgres connection string from whatever the host actually named it.
 *
 * Prisma's schema hard-codes env("DATABASE_URL"), but hosting integrations name the
 * variable to suit themselves — connecting Supabase through Vercel with a "DATABASE"
 * prefix yields DATABASE_POSTGRES_PRISMA_URL / DATABASE_POSTGRES_URL, Neon yields
 * POSTGRES_PRISMA_URL, and so on. Rather than ask anyone to hand-copy a credential
 * into a second variable, we look for the URL under every known name and publish it
 * as DATABASE_URL before the Prisma client is constructed.
 *
 * Order matters: the *pooled* Prisma URL comes first because these run on serverless
 * functions, where a direct connection exhausts Postgres' connection limit.
 */
const CANDIDATES = [
  "DATABASE_URL",
  "DATABASE_POSTGRES_PRISMA_URL",
  "POSTGRES_PRISMA_URL",
  "DATABASE_POSTGRES_URL",
  "POSTGRES_URL",
  "SUPABASE_DB_URL",
  "DATABASE_POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL_NON_POOLING",
] as const;

const isUsable = (v?: string) => !!v && (/^postgres(ql)?:\/\//.test(v) || v.startsWith("file:"));

/** The connection string Prisma should use, or undefined when none is configured. */
export function resolveDatabaseUrl(): string | undefined {
  for (const key of CANDIDATES) {
    const v = process.env[key];
    if (isUsable(v)) return v;
  }
  // Custom prefixes we don't know about: any *_URL holding a postgres:// value.
  for (const [k, v] of Object.entries(process.env)) {
    if (/_URL$/.test(k) && /^postgres(ql)?:\/\//.test(v || "")) return v;
  }
  return undefined;
}

/**
 * Publish the resolved URL as DATABASE_URL so `new PrismaClient()` finds it.
 * Safe to call repeatedly; never overwrites an explicit DATABASE_URL.
 */
export function ensureDatabaseUrl(): string | undefined {
  if (isUsable(process.env.DATABASE_URL)) return process.env.DATABASE_URL;
  const url = resolveDatabaseUrl();
  if (url) process.env.DATABASE_URL = url;
  return url;
}
