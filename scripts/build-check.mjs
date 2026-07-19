/**
 * Verify a production build WITHOUT touching `.next`.
 *
 * `next build` and `next dev` share the `.next` directory: running a build while
 * the dev server is up replaces its chunks and the running site starts throwing
 * "Cannot find module './627.js'" until it is restarted. This builds into
 * `.next-check` instead, so the dev server (and any tunnel pointed at it) keeps
 * serving throughout.
 *
 * Usage: npm run build:check
 */
import { spawn } from "node:child_process";

const child = spawn("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_DIST: ".next-check", NEXT_TELEMETRY_DISABLED: "1" },
});
child.on("exit", (code) => process.exit(code ?? 1));
