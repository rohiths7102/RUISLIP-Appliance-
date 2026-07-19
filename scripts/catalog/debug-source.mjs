/** Which store is the storefront actually reading from? */
const BASE = process.argv[2] || "http://localhost:3005";

// The admin overview prints "Data source: database|seed".
const s = await fetch(BASE + "/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@local", password: "admin" }), redirect: "manual",
});
const cookie = (s.headers.get("set-cookie") || "").split(";")[0];
const admin = await (await fetch(BASE + "/admin", { headers: { cookie } })).text();
const m = admin.match(/Data source:\s*<!--[^>]*-->?\s*([a-z]+)/) || admin.match(/Data source:[^a-z]*([a-z]+)/);
console.log("admin overview 'Data source' =", m ? m[1] : "(not found)");

// Count what the storefront renders.
const products = await (await fetch(BASE + "/products")).text();
console.log("storefront /products count =", (products.match(/([\d,]+)<\/strong>/) || [])[1]);

// Ask the DB directly.
const mod = await import("@prisma/client");
const db = new mod.PrismaClient();
try {
  const n = await db.product.count();
  console.log("database product count     =", n);
  const newest = await db.product.findFirst({ orderBy: { lastUpdatedByAdmin: "desc" }, select: { slug: true, productCode: true, title: true } });
  console.log("newest DB product          =", newest ? `${newest.productCode} -> /products/${newest.slug}` : "(none)");
  if (newest) {
    const r = await fetch(`${BASE}/products/${newest.slug}`);
    console.log(`  its page on the site     = HTTP ${r.status}  ${r.status === 200 ? "(DB IS driving the site)" : "(site is NOT reading the DB)"}`);
  }
} finally { await db.$disconnect(); }
