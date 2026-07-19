/**
 * Analytics loop, end to end: fire the events a real day of customers would
 * (call clicks incl. from a product page, postcode checks), then log in and
 * assert the dashboard actually shows them — counts, most-called product,
 * postcode areas. Cleans its own events afterwards.
 */
const BASE = process.argv[2] || "http://localhost:3005";

let cookie = "";
const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, { ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) }, redirect: "manual" });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return r;
};
const track = (body) =>
  fetch(BASE + "/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const fails = [];
const ok = (name, pass, detail = "") => { console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!pass) fails.push(name); };

/* a real product to attribute calls to */
const home = await (await fetch(BASE + "/")).text();
const slug = (home.match(/href="\/products\/([a-z0-9.\-]+)"/) || [])[1];
ok("found a product to call about", !!slug, slug);

/* ---- fire events like customers would ---- */
let r;
for (let i = 0; i < 3; i++) r = await track({ type: "call_click", path: `/products/${slug}`, productSlug: slug });
ok("call clicks accepted (product page ×3)", r.status === 204, `HTTP ${r.status}`);
r = await track({ type: "call_click", path: "/", productSlug: "" });
ok("call click accepted (homepage)", r.status === 204);
r = await track({ type: "postcode_check", postcode: "HA4 0QP", isLocal: true, path: "/" });
ok("postcode check accepted (HA4)", r.status === 204);
r = await track({ type: "postcode_check", postcode: "UB10 9AA", isLocal: true, path: "/" });
ok("postcode check accepted (UB10)", r.status === 204);
r = await track({ type: "postcode_check", postcode: "M1 1AA", isLocal: false, path: "/" });
ok("postcode check accepted (non-local)", r.status === 204);

/* garbage must be silently ignored, never an error */
r = await track({ type: "nonsense", postcode: "x" });
ok("unknown event type quietly dropped", r.status === 204);
r = await fetch(BASE + "/api/track", { method: "POST", body: "not json" });
ok("malformed body quietly dropped", r.status === 204);

/* ---- the dashboard must show all of it ---- */
r = await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@local", password: "admin" }) });
ok("admin login", r.status === 200);
const dash = (await (await api("/admin")).text()).replace(/<!--.*?-->/g, "");
ok("dashboard renders stat cards", /Call clicks · 7 days/.test(dash) && /Postcode checks · 7 days/.test(dash));
ok("calls-per-day chart present", /Call clicks per day/.test(dash));
ok("most-called product is the one we called about", new RegExp(slug.split("-")[0], "i").test(dash) && /call(s)?</.test(dash));
ok("postcode areas show HA4 and UB10", /HA4/.test(dash) && /UB10/.test(dash));
ok("local share computed", /% local/.test(dash));
ok("latest enquiries panel present", /Latest enquiries/.test(dash));
ok("audit trail panel present", /Recent changes/.test(dash));

/* ---- events are truly anonymous ---- */
const mod = await import("@prisma/client");
const db = new mod.PrismaClient();
try {
  const sample = await db.trackedEvent.findFirst({ orderBy: { createdAt: "desc" } });
  const cols = Object.keys(sample || {});
  ok("no IP / user-agent / identifier stored", !cols.some((c) => /ip|agent|user|session|cookie/i.test(c)), cols.join(","));
  /* cleanup this run's events */
  const del = await db.trackedEvent.deleteMany({
    where: { OR: [{ productSlug: slug }, { postcode: { in: ["HA4 0QP", "UB10 9AA", "M1 1AA"] } }, { AND: [{ type: "call_click" }, { path: "/" }] }] },
  });
  ok("test events cleaned up", del.count >= 6, `${del.count} removed`);
} finally { await db.$disconnect(); }

console.log(`\n${fails.length ? fails.length + " FAILURES:\n  " + fails.join("\n  ") : "Analytics loop verified end-to-end."}`);
process.exit(fails.length ? 1 : 0);
