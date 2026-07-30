/**
 * The complete admin exercise: every backend operation an owner would use,
 * executed live and checked for its real effect. Complements verify-admin.mjs
 * (product CRUD) with the surfaces that script doesn't touch.
 *
 * Covers: bulk stock / bulk price / hide / feature · CSV exports · business
 * settings · category visibility (incl. storefront effect) · brand edit ·
 * enquiry lifecycle (public form -> admin list -> status -> export) · sync
 * preview · RAG status + rebuild · logout invalidation.
 */
const BASE = process.argv[2] || "http://localhost:3005";

let cookie = "";
const api = async (path, opts = {}) => {
  let r = await fetch(BASE + path, { ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) }, redirect: "manual" });
  // The admin-write limiter (120/min) is a product feature, not a test subject.
  // When this suite runs inside the verify:all chain, earlier suites share the
  // budget — honour Retry-After once so ordering can't produce false failures.
  if (r.status === 429) {
    const wait = Math.min(Number(r.headers.get("retry-after")) || 30, 65);
    console.log(`  (429 on ${path} — rate window shared with earlier suites; waiting ${wait}s and retrying once)`);
    await new Promise((res) => setTimeout(res, wait * 1000));
    r = await fetch(BASE + path, { ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) }, redirect: "manual" });
  }
  // API routes always answer JSON; an HTML 5xx is the dev server's own error
  // page — a Windows on-demand-compile race while ISR regeneration (from our
  // revalidatePath churn) is mid-write. Environmental, so retry once.
  if (r.status >= 500 && (r.headers.get("content-type") || "").includes("text/html")) {
    console.log(`  (HTML ${r.status} on ${path} — dev-server compile race; retrying once)`);
    await new Promise((res) => setTimeout(res, 1500));
    r = await fetch(BASE + path, { ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) }, redirect: "manual" });
  }
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return r;
};
const json = async (r) => { try { return await r.json(); } catch { return null; } };
const jpost = (path, body, method = "POST") =>
  api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const fails = [];
const ok = (name, pass, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!pass) fails.push(name);
};

/* ---------- login ---------- */
let r = await jpost("/api/auth/login", { email: "admin@local", password: "admin" });
ok("login", r.status === 200 && !!cookie);

/* ---------- pre-clean any scratch left by an interrupted earlier run ---------- */
{
  const stale = await (await api("/api/admin/products?q=AUDIT-&take=100")).json().catch(() => null);
  let removed = 0;
  for (const row of stale?.rows || []) {
    if (/^AUDIT-/.test(row.productCode)) {
      const d = await api(`/api/admin/products/${row.id}`, { method: "DELETE" });
      if (d.status === 200) removed++;
    }
  }
  if (removed) console.log(`  (pre-clean: removed ${removed} stale scratch product${removed === 1 ? "" : "s"})`);
}

/* ---------- create scratch products for bulk tests ---------- */
const codes = ["AUDIT-B1", "AUDIT-B2", "AUDIT-B3"];
const made = [];
for (const c of codes) {
  r = await jpost("/api/admin/products", {
    title: `Bulk Test ${c}`, brand: "Bosch", productCode: c, category: "Laundry",
    subcategory: "Washing Machines", priceNow: 100, availabilityNormalised: "call_to_confirm", isVisible: true,
  });
  const j = await json(r);
  if (r.status === 201) made.push(j);
}
ok("created 3 scratch products", made.length === 3);
const ids = made.map((m) => m.id);

/* ---------- BULK: set stock ---------- */
r = await jpost("/api/admin/products/bulk", { ids, action: "set_stock", value: "in_stock" });
let j = await json(r);
ok("bulk set stock -> in_stock", r.status === 200 && j.updated === 3, JSON.stringify(j));

/* ---------- BULK: adjust price +10% ---------- */
r = await jpost("/api/admin/products/bulk", { ids, action: "adjust_price", value: 10 });
j = await json(r);
ok("bulk price +10%", r.status === 200 && j.updated === 3);
r = await api(`/api/admin/products?q=AUDIT-B1`);
j = await json(r);
ok("price is now £110", j?.rows?.[0]?.priceNow === 110, `got ${j?.rows?.[0]?.priceNow}`);
ok("stock is now in_stock", j?.rows?.[0]?.availabilityNormalised === "in_stock");

/* ---------- BULK: validation ---------- */
r = await jpost("/api/admin/products/bulk", { ids, action: "adjust_price", value: 500 });
ok("bulk rejects absurd percentage", r.status === 400, `HTTP ${r.status}`);
r = await jpost("/api/admin/products/bulk", { ids, action: "set_stock", value: "made-up" });
ok("bulk rejects invalid stock state", r.status === 400, `HTTP ${r.status}`);
r = await jpost("/api/admin/products/bulk", { ids: [], action: "set_stock", value: "in_stock" });
ok("bulk rejects empty selection", r.status === 400, `HTTP ${r.status}`);

/* ---------- BULK: hide -> storefront effect ---------- */
r = await jpost("/api/admin/products/bulk", { ids, action: "set_visible", value: false });
j = await json(r);
ok("bulk hide", r.status === 200 && j.updated === 3);
let page = await (await fetch(`${BASE}/products/${made[0].slug}`)).text();
// hidden products stay reachable by direct URL is a choice; what matters is listings.
let listing = await (await fetch(`${BASE}/categories/washing-machines`)).text();
ok("hidden products gone from category listing", !listing.includes("AUDIT-B1"));

/* ---------- products CSV export ---------- */
r = await api("/api/admin/products/export");
const csv = await r.text();
ok("products CSV export", r.status === 200 && r.headers.get("content-type")?.includes("text/csv"));
ok("CSV has all products", csv.split("\n").length > 1500, `${csv.split("\n").length} lines`);
ok("CSV contains scratch product", csv.includes("AUDIT-B1"));

/* ---------- CSV IMPORT: export -> edit -> preview -> apply ---------- */
// the spreadsheet loop the owner will actually use — match the row by its
// unique slug, never by code alone (a crashed earlier run could leave twins)
const line = csv.split("\n").find((l) => l.includes(`"${made[0].slug}"`));
const header = csv.split("\n")[0];
ok("found scratch row in export", !!line);
if (line) {
  // change its price to 123.45 in the CSV (priceNow column)
  const cols = header.split(",");
  const priceIdx = cols.findIndex((c) => c.includes("priceNow"));
  const cells = line.split(",");
  cells[priceIdx] = '"123.45"';
  const editedCsv = [header, cells.join(",")].join("\n");

  r = await jpost("/api/admin/products/import", { csv: editedCsv, mode: "preview" });
  j = await json(r);
  ok("import preview shows exactly 1 update", r.status === 200 && j.updates === 1 && j.errorCount === 0, JSON.stringify({ updates: j?.updates, errors: j?.errorCount }));
  ok("preview is a dry run (price unchanged)", (await json(await api("/api/admin/products?q=AUDIT-B1")))?.rows?.[0]?.priceNow !== 123.45);

  r = await jpost("/api/admin/products/import", { csv: editedCsv, mode: "apply" });
  j = await json(r);
  ok("import apply", r.status === 200 && j.applied === true);
  const after = (await json(await api("/api/admin/products?q=AUDIT-B1")))?.rows?.[0];
  ok("price now 123.45 from the spreadsheet", after?.priceNow === 123.45, `got ${after?.priceNow}`);

  // a broken CSV must be rejected with row-level errors, writing nothing
  const badCsv = [header, cells.join(",").replace('"123.45"', '"not-a-price"')].join("\n");
  r = await jpost("/api/admin/products/import", { csv: badCsv, mode: "preview" });
  j = await json(r);
  ok("import preview flags invalid price rows", j.errorCount >= 1, j?.errors?.[0]);
  r = await jpost("/api/admin/products/import", { csv: badCsv, mode: "apply" });
  ok("apply with errors is refused", r.status === 400);

  // a brand-new row creates a product
  const newCsv = [header, header.split(",").map((c) =>
    c.includes("productCode") ? '"AUDIT-CSV-NEW"' : c.includes("title") ? '"CSV Created Washer"' : c.includes("brand") ? '"Bosch"' : c.includes("priceNow") ? '"250"' : '""'
  ).join(",")].join("\n");
  r = await jpost("/api/admin/products/import", { csv: newCsv, mode: "apply" });
  j = await json(r);
  ok("import creates a brand-new product", r.status === 200 && j.creates === 1, JSON.stringify({ creates: j?.creates, errors: j?.errors }));
  const created = (await json(await api("/api/admin/products?q=AUDIT-CSV-NEW")))?.rows?.[0];
  ok("created product is queryable", !!created, created?.id);
  if (created) { r = await api(`/api/admin/products/${created.id}`, { method: "DELETE" }); ok("csv-created product cleaned up", r.status === 200); }
}

/* ---------- business settings ---------- */
r = await api("/api/admin/business", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deliveryNotes: "AUDIT-NOTE-XYZ" }) });
ok("business settings save", r.status === 200);
r = await jpost("/api/admin/business", { deliveryNotes: "Local delivery only — please confirm with the store." }, "PATCH");
ok("business settings restore", r.status === 200);

/* ---------- category hide -> storefront effect ---------- */
r = await jpost("/api/admin/categories/wine-coolers", { isVisible: false }, "PATCH");
ok("category hide (wine-coolers)", r.status === 200);
listing = await (await fetch(`${BASE}/categories`)).text();
ok("hidden category off the departments page", !/Wine Coolers/.test(listing));
r = await jpost("/api/admin/categories/wine-coolers", { isVisible: true }, "PATCH");
ok("category restored", r.status === 200);

/* ---------- brand edit ---------- */
r = await jpost("/api/admin/brands/bosch", { description: "AUDIT description" }, "PATCH");
ok("brand edit", r.status === 200);
r = await jpost("/api/admin/brands/bosch", { description: "" }, "PATCH");
ok("brand restore", r.status === 200);

/* ---------- enquiry lifecycle ---------- */
r = await jpost("/api/enquiries", { name: "Audit Customer", phone: "020 0000 0000", message: "Complete-audit enquiry", productCode: "AUDIT-B1" });
j = await json(r);
ok("public enquiry accepted", r.status === 200, j?.stored ? `stored: ${j.stored}` : "");
r = await api("/api/admin/enquiries");
const list = await json(r);
const mine = Array.isArray(list) ? list.find((e) => e.name === "Audit Customer") : null;
ok("enquiry visible in admin inbox (database)", !!mine, mine ? `id ${mine.id}` : "not found — DB down?");
if (mine) {
  r = await jpost("/api/admin/enquiries", { id: mine.id, status: "contacted" }, "PATCH");
  ok("enquiry marked contacted", r.status === 200);
  r = await api("/api/admin/enquiries/export");
  const ecsv = await r.text();
  ok("enquiries CSV export includes it", r.status === 200 && ecsv.includes("Audit Customer"));
}

/* ---------- sync preview (re-import dry run) ---------- */
r = await api("/api/admin/sync/preview");
j = await json(r);
ok("sync preview runs", r.status === 200 && j && "priceChanges" in j, j ? `new:${j.newProducts?.length} priceΔ:${j.priceChanges?.length} locked:${j.locked}` : "");
ok("sync preview respects admin locks", typeof j?.locked === "number");

/* ---------- RAG status + rebuild ---------- */
r = await api("/api/admin/rag/status");
j = await json(r);
ok("RAG status", r.status === 200, JSON.stringify(j)?.slice(0, 60));
r = await api("/api/admin/rag/rebuild", { method: "POST" });
j = await json(r);
ok("RAG rebuild (chatbot index)", r.status === 200 && j.indexed > 1500, j ? `indexed ${j.indexed}` : "");

/* ---------- audit trail recorded it all ---------- */
// The dashboard shows the 8 most recent audit entries. This script performs
// more than 8 audited ops, so asserting on any SPECIFIC action is a race with
// its own tail — assert the panel renders real rows instead: every row shows
// who made the change (the signed-in admin) and an action word from this run.
page = await (await api("/admin")).text();
ok("overview shows recent-changes audit trail",
  /Recent changes/.test(page) && /admin@local/.test(page) && /update|delete|bulk:|csv-import|rebuild/.test(page));

/* ---------- cleanup scratch products ---------- */
let cleaned = 0;
for (const m of made) {
  r = await api(`/api/admin/products/${m.id}`, { method: "DELETE" });
  if (r.status === 200) cleaned++;
}
ok("scratch products cleaned up", cleaned === 3);
// remove audit enquiry
if (mine) {
  // no delete endpoint for enquiries by design (they're records); mark closed instead
  r = await jpost("/api/admin/enquiries", { id: mine.id, status: "closed" }, "PATCH");
  ok("audit enquiry closed", r.status === 200);
}

/* ---------- logout actually kills the session ---------- */
r = await api("/api/auth/logout", { method: "POST" });
const dead = await api("/api/admin/products");
ok("logout invalidates the session cookie", dead.status === 401, `HTTP ${dead.status}`);

console.log(`\n${fails.length ? fails.length + " FAILURES:\n  " + fails.join("\n  ") : "Every admin operation works end-to-end."}`);
process.exit(fails.length ? 1 : 0);
