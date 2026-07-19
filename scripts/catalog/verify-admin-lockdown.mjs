/**
 * Verifies the admin lockdown behaviours that depend on env config. Run against
 * a server started with the relevant env:
 *
 *   default            (ADMIN_PATH unset)  — signin at /admin/signin, noindex, legacy redirect
 *   ADMIN_PATH=secret  — /secret/* rewrites to admin; /admin 404s (no backdoor)
 *   ADMIN_ALLOWED_IPS  — non-allowed IPs get 404 everywhere on admin
 *
 * Pass the mode so the script knows what to assert:
 *   node verify-admin-lockdown.mjs http://localhost:3005 default
 *   node verify-admin-lockdown.mjs http://localhost:3005 secret=<segment>
 *   node verify-admin-lockdown.mjs http://localhost:3005 ipblocked
 */
const [BASE = "http://localhost:3005", MODE = "default"] = process.argv.slice(2);
const fails = [];
const ok = (n, p, d = "") => { console.log(`  ${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); if (!p) fails.push(n); };
const head = async (p) => { const r = await fetch(BASE + p, { redirect: "manual" }); return { status: r.status, loc: r.headers.get("location") || "", robots: r.headers.get("x-robots-tag") || "" }; };

if (MODE === "default") {
  let r = await head("/admin/products");
  ok("anon /admin/products redirects to /admin/signin", (r.status === 307 || r.status === 302) && /\/admin\/signin/.test(r.loc), `${r.status} ${r.loc}`);
  r = await head("/admin/signin");
  ok("signin 200 + noindex", r.status === 200 && /noindex/.test(r.robots), `${r.status} ${r.robots}`);
  r = await head("/admin/login");
  ok("legacy /admin/login redirects to signin", /\/admin\/signin/.test(r.loc), r.loc);
}

if (MODE.startsWith("secret=")) {
  const seg = MODE.split("=")[1];
  let r = await head(`/${seg}/signin`);
  ok(`/${seg}/signin serves the admin (200 + noindex)`, r.status === 200 && /noindex/.test(r.robots), `${r.status} ${r.robots}`);
  r = await head(`/${seg}/products`);
  ok(`/${seg}/products redirects to /${seg}/signin (protected)`, (r.status === 307 || r.status === 302) && new RegExp(`/${seg}/signin`).test(r.loc), `${r.status} ${r.loc}`);
  r = await head("/admin/signin");
  ok("default /admin is a dead 404 (no backdoor)", r.status === 404, `HTTP ${r.status}`);
  r = await head("/admin/products");
  ok("default /admin/products is 404 too", r.status === 404, `HTTP ${r.status}`);
}

if (MODE === "ipblocked") {
  // server started with ADMIN_ALLOWED_IPS set to an IP that is NOT this client
  for (const p of ["/admin/signin", "/admin/products", "/admin"]) {
    const r = await head(p);
    ok(`${p} returns 404 for a non-allowed IP`, r.status === 404, `HTTP ${r.status}`);
  }
  const api = await fetch(BASE + "/api/admin/products");
  ok("/api/admin/* returns 404 for a non-allowed IP", api.status === 404, `HTTP ${api.status}`);
}

console.log(`\n${fails.length ? fails.length + " FAILURES" : "Lockdown mode '" + MODE + "' verified."}`);
process.exit(fails.length ? 1 : 0);
