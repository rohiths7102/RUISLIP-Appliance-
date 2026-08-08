/**
 * Run a script against the PRODUCTION Postgres database.
 *
 *   node scripts/db/with-prod-db.mjs <script> [args…]
 *
 * Resolves the Postgres URL from .env.local / .env in-process — the credential is
 * set into DATABASE_URL for the child and never printed (only the host is logged,
 * so the operator can see which database is about to be written). Direct
 * (non-pooling) connections are preferred, same reasoning as engine.mjs: scripts
 * run long transactions a pgbouncer pooler does not support.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

for (const f of [".env.local", ".env"]) {
  const fp = join(process.cwd(), f);
  if (!existsSync(fp)) continue;
  for (const line of readFileSync(fp, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PG_VARS = [
  "DATABASE_POSTGRES_URL_NON_POOLING", "POSTGRES_URL_NON_POOLING",
  "SUPABASE_DB_URL", "DATABASE_POSTGRES_URL", "POSTGRES_URL",
  "DATABASE_POSTGRES_PRISMA_URL", "POSTGRES_PRISMA_URL",
];
const isPg = (u) => /^postgres(ql)?:\/\//.test(u || "");
let found = null;
for (const k of PG_VARS) if (isPg(process.env[k])) { found = { key: k, url: process.env[k] }; break; }
if (!found) {
  for (const [k, v] of Object.entries(process.env)) if (/_URL$/.test(k) && isPg(v)) { found = { key: k, url: v }; break; }
}
if (!found) { console.error("✗ no Postgres URL in .env.local/.env — nothing to run against"); process.exit(1); }

process.env.DATABASE_URL = found.url;
console.log(`production target: ${found.key} → host ${new URL(found.url).hostname}`);

const [target, ...rest] = process.argv.slice(2);
if (!target) { console.error("usage: node scripts/db/with-prod-db.mjs <script> [args…]"); process.exit(1); }
const isTs = /\.tsx?$/.test(target);
const cmd = isTs ? "npx" : "node";
const args = isTs ? ["tsx", target, ...rest] : [target, ...rest];
const useShell = process.platform === "win32";
const finalArgs = useShell ? args.map((a) => (/\s/.test(a) && !/^".*"$/.test(a) ? `"${a}"` : a)) : args;
const r = spawnSync(cmd, finalArgs, { stdio: "inherit", shell: useShell, env: process.env });
process.exit(r.status ?? 1);
