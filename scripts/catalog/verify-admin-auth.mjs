/**
 * Auth boundary: every admin page must bounce an anonymous visitor to the login
 * screen, and every admin API must refuse them — using each route's REAL verb
 * (a 405 from using the wrong method proves nothing).
 */
const BASE = process.argv[2] || "http://localhost:3005";
const fails = [];
const ok = (n, p, d = "") => { console.log(`  ${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); if (!p) fails.push(n); };

console.log("\nPAGES — anonymous must be redirected to the sign-in page");
for (const p of ["/admin", "/admin/products", "/admin/categories", "/admin/brands", "/admin/enquiries", "/admin/settings", "/admin/chatbot", "/admin/sync"]) {
  const r = await fetch(BASE + p, { redirect: "manual" });
  const loc = r.headers.get("location") || "";
  ok(p, (r.status === 307 || r.status === 302) && /\/admin\/signin/.test(loc), `HTTP ${r.status} -> ${loc || "(no location)"}`);
}

console.log("\nSIGN-IN — page loads, old /admin/login redirects, admin responses are noindex");
{
  const s = await fetch(BASE + "/admin/signin");
  ok("/admin/signin loads (200)", s.status === 200, `HTTP ${s.status}`);
  ok("/admin/signin is noindex", /noindex/i.test(s.headers.get("x-robots-tag") || ""), s.headers.get("x-robots-tag") || "(none)");
  const legacy = await fetch(BASE + "/admin/login", { redirect: "manual" });
  ok("/admin/login redirects to /admin/signin", (legacy.status === 307 || legacy.status === 308) && /\/admin\/signin/.test(legacy.headers.get("location") || ""), `HTTP ${legacy.status} -> ${legacy.headers.get("location")}`);
  // open-redirect guard: a hostile callbackUrl must not survive login
  const evil = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@local", password: "admin", callbackUrl: "https://evil.example/steal" }) });
  const j = await evil.json().catch(() => ({}));
  ok("open-redirect callbackUrl is rejected", evil.status !== 200 || (j.redirect && j.redirect.startsWith("/") && !j.redirect.includes("evil")), `redirect=${j.redirect}`);
}

console.log("\nAPIS — anonymous must get 401, called with each route's real verb");
const CASES = [
  ["GET", "/api/admin/products"],
  ["POST", "/api/admin/products", { title: "x", productCode: "x" }],
  ["PATCH", "/api/admin/products/anything", { priceNow: 1 }],
  ["DELETE", "/api/admin/products/anything"],
  ["POST", "/api/admin/upload"],
  ["PATCH", "/api/admin/business", { phone: "hacked" }],
  ["GET", "/api/admin/overview"],
  ["GET", "/api/admin/enquiries"],
  ["GET", "/api/admin/enquiries/export"],
  ["POST", "/api/admin/rag/rebuild"],
  ["GET", "/api/admin/rag/status"],
  ["POST", "/api/admin/sync/apply"],
  ["GET", "/api/admin/sync/preview"],
  ["PATCH", "/api/admin/brands/anything", { name: "x" }],
  ["PATCH", "/api/admin/categories/anything", { name: "x" }],
];
for (const [method, path, body] of CASES) {
  const r = await fetch(BASE + path, {
    method,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  ok(`${method} ${path}`, r.status === 401, `HTTP ${r.status}`);
}

console.log("\nLOGIN");
let r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@local", password: "nope" }) });
ok("wrong password -> 401", r.status === 401, `HTTP ${r.status}`);
r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "someone@else.com", password: "admin" }) });
ok("wrong email -> 401", r.status === 401, `HTTP ${r.status}`);
r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@local", password: "admin" }), redirect: "manual" });
const cookie = r.headers.get("set-cookie") || "";
ok("correct password -> 200 + httpOnly cookie", r.status === 200 && /HttpOnly/i.test(cookie), cookie.split(";")[0]);

console.log("\nFORGED COOKIE");
r = await fetch(BASE + "/api/admin/products", { headers: { cookie: "admin_session=eyJlbWFpbCI6ImhhY2tlckBldmlsLmNvbSJ9.deadbeef" } });
ok("garbage signature rejected", r.status === 401, `HTTP ${r.status}`);

console.log(`\n${CASES.length + 8 - fails.length}/${CASES.length + 8} passed`);
if (fails.length) { console.log("FAILURES:\n  " + fails.join("\n  ")); process.exit(1); }
console.log("Admin boundary holds.");
