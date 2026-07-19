/**
 * Before SESSION_SECRET was set, lib/auth.ts fell back to the literal string
 * "dev-insecure-secret-change-me" — which is public in the source. Anyone could
 * mint a valid admin cookie without ever knowing the password. Prove that's dead.
 */
import crypto from "node:crypto";
const BASE = process.argv[2] || "http://localhost:3005";

const forge = (secret) => {
  const body = Buffer.from(JSON.stringify({ email: "attacker@evil.com", exp: Math.floor(Date.now() / 1000) + 86400 })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
};

const fails = [];
const ok = (n, p, d = "") => { console.log(`  ${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); if (!p) fails.push(n); };

// The exact fallback secret from the source.
let r = await fetch(BASE + "/api/admin/products", { headers: { cookie: `admin_session=${forge("dev-insecure-secret-change-me")}` } });
ok("cookie forged with the public fallback secret is REJECTED", r.status === 401, `HTTP ${r.status}`);

r = await fetch(BASE + "/api/admin/products", { method: "DELETE", headers: { cookie: `admin_session=${forge("dev-insecure-secret-change-me")}` } });
ok("forged cookie cannot reach a destructive route", r.status === 401 || r.status === 405, `HTTP ${r.status}`);

r = await fetch(BASE + "/admin/products", { headers: { cookie: `admin_session=${forge("dev-insecure-secret-change-me")}` }, redirect: "manual" });
ok("forged cookie bounced from the admin UI", r.status === 307 || r.status === 302, `HTTP ${r.status}`);

// A real login must still work.
r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@local", password: "admin" }), redirect: "manual" });
const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
ok("genuine login still issues a working session", r.status === 200 && !!cookie);
r = await fetch(BASE + "/api/admin/products", { headers: { cookie } });
ok("genuine session can read products", r.status === 200, `HTTP ${r.status}`);

console.log(fails.length ? `\n${fails.length} FAILED` : "\nCookie forgery is closed.");
process.exit(fails.length ? 1 : 0);
