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
 *
 * Reads .env.local / .env itself (plain `node` doesn't), so secrets live there.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

const SQLITE_SCHEMA = join(ROOT, "prisma", "schema.prisma");
const PG_SCHEMA = join(ROOT, "prisma", "schema.postgres.prisma");

/** Regenerate the Postgres schema from the sqlite source of truth. */
function writePgSchema() {
  const src = readFileSync(SQLITE_SCHEMA, "utf8");
  const out =
    "// GENERATED from schema.prisma by scripts/db/engine.mjs — do not edit by hand.\n" +
    src.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
  writeFileSync(PG_SCHEMA, out);
  return PG_SCHEMA;
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
  // `prisma generate` only reads the schema, but it still refuses to run when the
  // datasource's env var is undefined. A CI/Vercel build with DATABASE_URL not yet
  // set must not fail for that reason alone — the client it emits is identical.
  const placeholder = url ? {} : { DATABASE_URL: "file:./dev.db" };
  if (!url) console.log("engine: DATABASE_URL not set — generating the sqlite client with a placeholder URL (set it in the host's env for runtime)");

  if (isPg(url)) {
    const schema = writePgSchema();
    console.log("engine: postgresql (DATABASE_URL) — generating client");
    run("npx", ["prisma", "generate", "--schema", schema], placeholder);
  } else {
    console.log("engine: sqlite — generating client");
    run("npx", ["prisma", "generate"], placeholder);
  }
} else if (mode === "deploy") {
  // Push schema + seed into Postgres, using whichever env var actually holds the URL.
  const found = findPgUrl();
  if (!found) {
    console.error("✗ No Postgres URL found in the environment or .env.local.");
    console.error(`  Looked for: ${PG_VARS.join(", ")} (and any *_URL holding a postgres:// value).`);
    console.error("  Fix: connect the database in Vercel and run `npx vercel env pull .env.local`,");
    console.error("       or paste SUPABASE_DB_URL=postgresql://... into .env.local yourself.");
    process.exit(1);
  }
  const pg = found.url;
  console.log(`engine: using ${found.key} → ${pg.replace(/:\/\/[^@]*@/, "://***:***@")}`);
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
} else {
  console.error(`Unknown mode "${mode}" — use generate | deploy`);
  process.exit(1);
}
