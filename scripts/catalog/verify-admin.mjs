/**
 * Proves the admin actually drives the storefront, like an ecommerce backend:
 *   log in -> add a product -> it appears on the site -> edit price/stock ->
 *   the site updates -> hide it -> it disappears -> delete it -> 404.
 *
 * Usage: node scripts/catalog/verify-admin.mjs [baseUrl]
 */
const BASE = process.argv[2] || "http://localhost:3005";
const CODE = "AUDIT-" + Math.random().toString(36).slice(2, 7).toUpperCase();

let cookie = "";
const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, { ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) }, redirect: "manual" });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return r;
};
const json = async (r) => { try { return await r.json(); } catch { return null; } };

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

console.log("\n1. AUTH");
let r = await api("/api/admin/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "x", productCode: "x" }) });
check("create is rejected when logged out", r.status === 401, `HTTP ${r.status}`);
r = await api("/admin/products");
check("/admin/products redirects when logged out", r.status === 307 || r.status === 302, `HTTP ${r.status}`);
r = await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@local", password: "wrong-password" }) });
check("wrong password rejected", r.status === 401, `HTTP ${r.status}`);
r = await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@local", password: "admin" }) });
check("login succeeds", r.status === 200 && !!cookie);

console.log("\n2. CREATE (upload a product)");
r = await api("/api/admin/products", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "Audit Test Washing Machine 9kg", brand: "Bosch", productCode: CODE,
    category: "Laundry", subcategory: "Washing Machines", priceNow: 499, priceWas: 599,
    availabilityNormalised: "in_stock", warranty: "5 year guarantee",
    shortDescription: "Created by the admin audit.", isVisible: true,
  }),
});
const created = await json(r);
check("product created", r.status === 201 && !!created?.id, `HTTP ${r.status}`);
check("slug generated", !!created?.slug, created?.slug);
check("saving auto-calculated from was/now", created?.saving === 100, `saving=${created?.saving}`);
check("new product is locked against re-import", Array.isArray(created?.adminOverrideFields) && created.adminOverrideFields.length > 0);

console.log("\n3. IT APPEARS ON THE STOREFRONT");
let page = await (await fetch(`${BASE}/products/${created.slug}`)).text();
check("product page renders", page.includes(CODE), `/products/${created.slug}`);
check("price shows on the page", page.includes("£499"));
check("phone CTA present", page.includes("tel:02088645763"));
let listing = await (await fetch(`${BASE}/categories/washing-machines`)).text();
check("appears in its category listing", listing.includes(CODE));

console.log("\n4. VALIDATION");
r = await api(`/api/admin/products/${created.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priceNow: "12,50" }) });
check("rejects a non-numeric price", r.status === 400, `HTTP ${r.status}`);
r = await api(`/api/admin/products/${created.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priceNow: -5 }) });
check("rejects a negative price", r.status === 400, `HTTP ${r.status}`);
r = await api(`/api/admin/products/${created.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ availabilityNormalised: "totally-made-up" }) });
check("rejects an invalid stock state", r.status === 400, `HTTP ${r.status}`);
r = await api("/api/admin/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "No code here" }) });
check("requires a product code", r.status === 400, `HTTP ${r.status}`);

console.log("\n5. EDIT PRICE + STOCK -> STOREFRONT UPDATES");
r = await api(`/api/admin/products/${created.id}`, {
  method: "PATCH", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ priceNow: 429, availabilityNormalised: "awaiting_stock" }),
});
check("edit saved", r.status === 200, `HTTP ${r.status}`);
page = await (await fetch(`${BASE}/products/${created.slug}`)).text();
check("new price live on the site", page.includes("£429") && !page.includes("£499"));
check("new stock state live on the site", /Awaiting stock/i.test(page));

console.log("\n6. IMAGE UPLOAD");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let fd = new FormData();
fd.append("file", new Blob([png], { type: "image/png" }), "test.png");
r = await api("/api/admin/upload", { method: "POST", body: fd });
const up = await json(r);
check("png upload accepted", r.status === 200 && !!up?.url, up?.url);
fd = new FormData();
fd.append("file", new Blob([Buffer.from("MZ this is an executable, not an image")], { type: "image/png" }), "evil.png");
r = await api("/api/admin/upload", { method: "POST", body: fd });
check("non-image rejected despite image/png content-type", r.status === 415, `HTTP ${r.status}`);
fd = new FormData();
fd.append("file", new Blob([Buffer.from("x")], { type: "application/x-msdownload" }), "evil.exe");
r = await api("/api/admin/upload", { method: "POST", body: fd });
check("executable type rejected", r.status === 415, `HTTP ${r.status}`);
if (up?.url) {
  r = await api(`/api/admin/products/${created.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mainImage: up.url }) });
  check("uploaded image attached to product", r.status === 200);
  const img = await fetch(BASE + up.url);
  check("uploaded image is publicly served", img.status === 200, `${up.url} -> ${img.status}`);
}

console.log("\n7. HIDE -> DISAPPEARS FROM THE SHOP");
await api(`/api/admin/products/${created.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isVisible: false }) });
listing = await (await fetch(`${BASE}/categories/washing-machines`)).text();
check("hidden product removed from listings", !listing.includes(CODE));
await api(`/api/admin/products/${created.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isVisible: true }) });

console.log("\n8. AUDIT TRAIL");
r = await api(`/api/admin/products?q=${CODE}`);
const list = await json(r);
check("admin search finds it", list?.rows?.some((x) => x.productCode === CODE), `${list?.total} match(es)`);

console.log("\n9. DELETE -> GONE FROM THE SHOP");
r = await api(`/api/admin/products/${created.id}`, { method: "DELETE" });
check("delete succeeds", r.status === 200, `HTTP ${r.status}`);
const gone = await fetch(`${BASE}/products/${created.slug}`);
check("product page now 404s", gone.status === 404, `HTTP ${gone.status}`);
listing = await (await fetch(`${BASE}/categories/washing-machines`)).text();
check("gone from category listing", !listing.includes(CODE));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("\nFAILURES:"); for (const f of failed) console.log("  ✗ " + f.name + (f.detail ? ` (${f.detail})` : "")); process.exit(1); }
console.log("The admin drives the storefront end-to-end.");
