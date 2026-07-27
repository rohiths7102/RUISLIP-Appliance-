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
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const mode = process.argv[2] || "generate";
const url = process.env.DATABASE_URL || "";
const isPg = (u) => /^postgres(ql)?:\/\//.test(u);

if (mode === "generate") {
  if (isPg(url)) {
    const schema = writePgSchema();
    console.log("engine: postgresql (DATABASE_URL) — generating client");
    run("npx", ["prisma", "generate", "--schema", schema]);
  } else {
    console.log("engine: sqlite (local dev) — generating client");
    run("npx", ["prisma", "generate"]);
  }
} else if (mode === "deploy") {
  // Push schema + seed into Postgres. Accepts SUPABASE_DB_URL (preferred locally,
  // keeps sqlite DATABASE_URL untouched) or an already-postgres DATABASE_URL.
  const pg = process.env.SUPABASE_DB_URL || (isPg(url) ? url : "");
  if (!pg) {
    console.error("✗ No Postgres URL. Put SUPABASE_DB_URL=postgresql://... in .env.local (Supabase → Connect → Transaction pooler URI).");
    process.exit(1);
  }
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
