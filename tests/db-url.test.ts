/**
 * The connection-string resolver decides which env var Prisma actually uses in
 * production, so its precedence rules are worth pinning down. Synthetic values
 * only — no real credentials.
 *
 * Run: npx tsx tests/db-url.test.ts
 */
import { resolveDatabaseUrl, ensureDatabaseUrl } from "../lib/db-url";

const KEYS = [
  "DATABASE_URL", "DATABASE_POSTGRES_PRISMA_URL", "POSTGRES_PRISMA_URL",
  "DATABASE_POSTGRES_URL", "POSTGRES_URL", "SUPABASE_DB_URL",
  "DATABASE_POSTGRES_URL_NON_POOLING", "POSTGRES_URL_NON_POOLING", "WEIRD_CUSTOM_URL",
];
const clear = () => KEYS.forEach((k) => delete process.env[k]);

let pass = 0, fail = 0;
const t = (name: string, cond: boolean) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
  cond ? pass++ : fail++;
};

clear();
process.env.DATABASE_POSTGRES_PRISMA_URL = "postgresql://u:p@h:6543/db?pgbouncer=true";
t("picks the Vercel+Supabase prisma URL", resolveDatabaseUrl() === process.env.DATABASE_POSTGRES_PRISMA_URL);

clear();
process.env.DATABASE_URL = "postgresql://explicit@h/db";
process.env.DATABASE_POSTGRES_PRISMA_URL = "postgresql://other@h/db";
t("an explicit DATABASE_URL wins", resolveDatabaseUrl() === "postgresql://explicit@h/db");

clear();
process.env.DATABASE_POSTGRES_URL = "postgresql://u:p@h:5432/db";
process.env.DATABASE_POSTGRES_PRISMA_URL = "postgresql://pooled@h:6543/db";
t("prefers the pooled URL over the direct one (serverless conn limits)", resolveDatabaseUrl() === "postgresql://pooled@h:6543/db");

clear();
process.env.WEIRD_CUSTOM_URL = "postgresql://u:p@h/db";
t("falls back to any *_URL holding postgres://", resolveDatabaseUrl() === "postgresql://u:p@h/db");

clear();
process.env.DATABASE_URL = "file:./dev.db";
t("leaves a local sqlite URL alone", resolveDatabaseUrl() === "file:./dev.db");

clear();
process.env.DATABASE_SUPABASE_ANON_KEY = "eyJhbGciOi-not-a-url";
t("ignores Supabase keys that aren't connection strings", resolveDatabaseUrl() === undefined);
delete process.env.DATABASE_SUPABASE_ANON_KEY;

clear();
process.env.DATABASE_POSTGRES_PRISMA_URL = "postgresql://u:p@h:6543/db";
ensureDatabaseUrl();
t("ensureDatabaseUrl publishes it as DATABASE_URL", process.env.DATABASE_URL === "postgresql://u:p@h:6543/db");

clear();
t("returns undefined when nothing is configured", resolveDatabaseUrl() === undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
