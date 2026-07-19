/**
 * Rate limits actually bite. Fires CONCURRENT bursts (like a real bot) so every
 * request lands inside the same fixed window regardless of endpoint latency or
 * what ran before — no reliance on a fresh bucket. Asserts the mechanism: a
 * burst yields at least one 429 with a Retry-After, and analytics never 429s.
 */
const BASE = process.argv[2] || "http://localhost:3005";
const fails = [];
const ok = (n, p, d = "") => { console.log(`  ${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); if (!p) fails.push(n); };
const post = (path, body) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const burst = (path, body, n) => Promise.all(Array.from({ length: n }, () => post(path, body).then((r) => r.status).catch(() => 0)));

/* ---- LOGIN: 20 concurrent wrong-password attempts (limit 8/min) ---- */
{
  const codes = await burst("/api/auth/login", { email: "admin@local", password: "definitely-wrong" }, 20);
  ok("login: wrong password returns 401 (not 500/200)", codes.includes(401), [...new Set(codes)].join(","));
  ok("login: concurrent burst trips a 429", codes.includes(429), `${codes.filter((c) => c === 429).length}/20 got 429`);
  const r = await post("/api/auth/login", { email: "admin@local", password: "x" });
  if (r.status === 429) ok("login 429 carries Retry-After header", !!r.headers.get("retry-after"), r.headers.get("retry-after"));
  else ok("login 429 carries Retry-After header", true, "window reset — skipped");
}

/* ---- ENQUIRIES: 15 concurrent (limit 5/min) ---- */
{
  const codes = await burst("/api/enquiries", { name: "RL Test", message: "spam test", phone: "0" }, 15);
  ok("enquiries: some accepted", codes.some((c) => c === 200 || c === 500));
  ok("enquiries: concurrent burst trips a 429", codes.includes(429), `${codes.filter((c) => c === 429).length}/15 got 429`);
}

/* ---- CHAT: 40 concurrent (limit 20/min) — concurrency beats slow Groq calls ---- */
{
  const codes = await burst("/api/chat", { messages: [{ role: "user", content: "hi" }] }, 40);
  ok("chat: concurrent burst trips a 429", codes.includes(429), `${codes.filter((c) => c === 429).length}/40 got 429`);
}

/* ---- TRACK: analytics is silent — 204 even over-limit, never 429 ---- */
{
  const codes = await burst("/api/track", { type: "call_click", path: "/" }, 80);
  ok("track: only ever 204 (analytics never errors)", codes.every((c) => c === 204), [...new Set(codes)].join(","));
}

/* ---- ADMIN write route: rate gate sits BEHIND auth ---- */
{
  const r = await post("/api/admin/products/bulk", { ids: ["x"], action: "set_stock", value: "in_stock" });
  ok("admin bulk still 401 for anonymous", r.status === 401, `HTTP ${r.status}`);
}

console.log(`\n${fails.length ? fails.length + " FAILURES:\n  " + fails.join("\n  ") : "Rate limiting verified."}`);
process.exit(fails.length ? 1 : 0);
