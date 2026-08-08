/**
 * One schema, two engines. prisma/schema.prisma (sqlite) is the single source of
 * truth; the Postgres variant is GENERATED from it here — never hand-edited — so
 * the engines can't drift.
 *
 *   node scripts/db/engine.mjs generate   -> prisma generate for whichever engine
 *                                            DATABASE_URL points at (build step)
 *   node scripts/db/engine.mjs deploy     -> push schema + seed catalogue into the
 *                                            Postgres given by SUPABASE_DB_URL /
 *                                            DATABASE_URL (one-time setup)
 *   node scripts/db/engine.mjs client:pg  -> generate a SEPARATE Postgres client for
 *                                            the maintenance scripts and print the
 *                                            PRISMA_CLIENT_DIR they expect
 *
 * Reads .env.local / .env itself (plain `node` doesn't), so secrets live there.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

// --- env loading (.env.local wins, matching Next.js) ---
for (const f of [".env.local", ".env"]) {
  const fp = join(ROOT, f);
  if (!existsSync(fp)) continue;
  for (const line of readFileSync(fp, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// Hosting integrations name the Postgres URL differently depending on which
// provider and prefix you picked when connecting (Vercel+Supabase, Neon, Railway…).
// Accept any of them for `deploy` so a naming mismatch can't block the migration.
// Order matters and is the OPPOSITE of the runtime order in lib/db-url.ts:
// `prisma db push` and the seed issue DDL and long transactions, which a
// transaction pooler (pgbouncer, port 6543) does not support — so prefer the
// DIRECT connection here. The app itself wants the pooled URL at runtime.
const PG_VARS = [
  "DATABASE_POSTGRES_URL_NON_POOLING", "POSTGRES_URL_NON_POOLING",
  "SUPABASE_DB_URL", "DATABASE_URL", "DATABASE_POSTGRES_URL", "POSTGRES_URL",
  "STORAGE_URL", "DB_URL",
  "DATABASE_POSTGRES_PRISMA_URL", "POSTGRES_PRISMA_URL", // pooled — last resort
];
const isPgUrl = (u) => /^postgres(ql)?:\/\//.test(u || "");
/** First env var holding a real Postgres URL, with its name (for logging). */
function findPgUrl() {
  for (const k of PG_VARS) if (isPgUrl(process.env[k])) return { key: k, url: process.env[k] };
  // last resort: any *_URL that looks like Postgres (covers custom prefixes)
  for (const [k, v] of Object.entries(process.env)) if (/_URL$/.test(k) && isPgUrl(v)) return { key: k, url: v };
  return null;
}

/** Same, but the modes that WRITE to Postgres can't proceed without one. */
function requirePgUrl() {
  const found = findPgUrl();
  if (found) return found;
  console.error("✗ No Postgres URL found in the environment or .env.local.");
  console.error(`  Looked for: ${PG_VARS.join(", ")} (and any *_URL holding a postgres:// value).`);
  console.error("  Fix: connect the database in Vercel and run `npx vercel env pull .env.local`,");
  console.error("       or paste SUPABASE_DB_URL=postgresql://... into .env.local yourself.");
  process.exit(1);
}

/** Never print a connection string with its password in it. */
const maskUrl = (u) => u.replace(/:\/\/[^@]*@/, "://***:***@");

const SQLITE_SCHEMA = join(ROOT, "prisma", "schema.prisma");
const PG_SCHEMA = join(ROOT, "prisma", "schema.postgres.prisma");
// Home of the isolated maintenance client (PRISMA_CLIENT_DIR). Inside the repo but
// git-ignored, so the production recipe is reproducible on any machine instead of
// depending on a folder someone made by hand.
const PG_CLIENT_ROOT = join(ROOT, ".prisma-pg");
const PG_CLIENT_SCHEMA = join(PG_CLIENT_ROOT, "schema.prisma");
const PG_CLIENT_DIR = join(PG_CLIENT_ROOT, "client");

/** The sqlite schema retargeted at Postgres — the only edit ever made to it. */
function pgSource() {
  const src = readFileSync(SQLITE_SCHEMA, "utf8");
  return (
    "// GENERATED from schema.prisma by scripts/db/engine.mjs — do not edit by hand.\n" +
    src.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"')
  );
}

/** Regenerate the Postgres schema from the sqlite source of truth. */
function writePgSchema() {
  writeFileSync(PG_SCHEMA, pgSource());
  return PG_SCHEMA;
}

/** The same Postgres schema with the generator redirected to its own directory —
 *  without `output` prisma would overwrite the default client in node_modules,
 *  which is the sqlite one a running dev server has already loaded. */
function writePgClientSchema() {
  // Relative to the schema's own folder: an absolute Windows path would need its
  // backslashes escaped inside a Prisma string.
  const out = pgSource().replace(/(generator\s+client\s*\{)/, '$1\n  output   = "./client"');
  mkdirSync(PG_CLIENT_ROOT, { recursive: true });
  writeFileSync(PG_CLIENT_SCHEMA, out);
  return PG_CLIENT_SCHEMA;
}

function run(cmd, args, extraEnv = {}) {
  // Windows needs shell:true to find `npx`, but a shell concatenates argv without
  // escaping — so any path containing a space (e.g. "D:\website APP\…") is split
  // into two arguments. Quote them ourselves.
  const useShell = process.platform === "win32";
  const finalArgs = useShell ? args.map((a) => (/\s/.test(a) && !/^".*"$/.test(a) ? `"${a}"` : a)) : args;
  const r = spawnSync(cmd, finalArgs, { stdio: "inherit", shell: useShell, env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const mode = process.argv[2] || "generate";
const url = process.env.DATABASE_URL || "";
const isPg = (u) => /^postgres(ql)?:\/\//.test(u);

if (mode === "generate") {
  // The generated client is bound to ONE provider, so this choice must match what
  // lib/db-url.ts will resolve at runtime — otherwise the deployed app builds a
  // sqlite client, is handed a postgres:// URL, and every query fails.
  //
  // An explicit DATABASE_URL always wins (that is how local dev pins sqlite).
  // Otherwise fall back to the same discovery the runtime uses, because hosts
  // publish the connection string under their own names (Vercel + Supabase gives
  // DATABASE_POSTGRES_PRISMA_URL and never a plain DATABASE_URL).
  const explicit = url || "";
  const discovered = explicit ? null : findPgUrl();
  const usePg = isPg(explicit) || !!discovered;
  const generateUrl = explicit || discovered?.url || "file:./dev.db";

  if (usePg) {
    const schema = writePgSchema();
    console.log(`engine: postgresql (${explicit ? "DATABASE_URL" : discovered.key}) — generating client`);
    run("npx", ["prisma", "generate", "--schema", schema], { DATABASE_URL: generateUrl });
  } else {
    if (!explicit) console.log("engine: no database configured — generating the sqlite client with a placeholder URL");
    console.log("engine: sqlite — generating client");
    run("npx", ["prisma", "generate"], { DATABASE_URL: generateUrl });
  }
} else if (mode === "deploy") {
  // Push schema + seed into Postgres, using whichever env var actually holds the URL.
  const found = requirePgUrl();
  const pg = found.url;
  console.log(`engine: using ${found.key} → ${maskUrl(pg)}`);
  const schema = writePgSchema();
  console.log("engine: postgresql — pushing schema to Supabase…");
  run("npx", ["prisma", "db", "push", "--schema", schema, "--accept-data-loss"], { DATABASE_URL: pg });
  console.log("engine: generating client for postgresql…");
  run("npx", ["prisma", "generate", "--schema", schema], { DATABASE_URL: pg });
  console.log("engine: seeding catalogue (1,577 products) into Supabase…");
  run("npx", ["tsx", "prisma/seed.ts"], { DATABASE_URL: pg });
  console.log("engine: restoring local sqlite client…");
  run("npx", ["prisma", "generate"]);
  console.log("\n✓ Supabase is seeded. Set DATABASE_URL to the same URI in Vercel env vars.");
} else if (mode === "client:pg") {
  // The maintenance scripts (catalogue import/repair, RAG rebuild) reach production
  // through PRISMA_CLIENT_DIR. That client has to live OUTSIDE the default one:
  // regenerating the default client swaps it to postgresql under the running dev
  // server, which is bound to sqlite. So this mode deliberately never runs a plain
  // `prisma generate` — nothing here touches node_modules/@prisma/client.
  const found = requirePgUrl();
  const pg = found.url;
  console.log(`engine: using ${found.key} → ${maskUrl(pg)}`);
  const schema = writePgClientSchema();
  console.log("engine: postgresql — generating the isolated maintenance client…");
  run("npx", ["prisma", "generate", "--schema", schema], { DATABASE_URL: pg });
  console.log("\n✓ Postgres client generated; the local sqlite client is untouched. Use it with:");
  console.log(`\n  PRISMA_CLIENT_DIR="${PG_CLIENT_DIR}" node scripts/db/with-prod-db.mjs scripts/rag/rebuild-from-db.ts`);
  console.log(`\n  PowerShell: $env:PRISMA_CLIENT_DIR="${PG_CLIENT_DIR}"; node scripts/db/with-prod-db.mjs scripts/rag/rebuild-from-db.ts`);
} else {
  console.error(`Unknown mode "${mode}" — use generate | deploy | client:pg`);
  process.exit(1);
}
