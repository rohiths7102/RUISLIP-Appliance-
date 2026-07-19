/**
 * Slice 4 orchestrator — crawl kitchen-appliances.co.uk and write the full data set
 * the DB importer (Slice 5, syncToDatabase.ts) reads. Respects robots.txt crawl-delay.
 *
 *   npm run scrape                 full crawl
 *   npm run scrape:discover        crawl only -> discovered-urls.json
 *   npm run scrape:sample          first N products
 *   tsx runScrape.ts --limit 25 --skip-media --debug
 */
import fs from "fs-extra";
import path from "node:path";
import pLimit from "p-limit";
import { crawl, isProductUrl } from "./crawl.js";
import { fetchText } from "./http.js";
import { extractProduct } from "./extractProduct.js";
import { extractCategory } from "./extractCategory.js";
import { extractPage } from "./extractPage.js";
import { extractBusinessInfo } from "./extractBusinessInfo.js";
import { extractBrands } from "./extractBrand.js";
import { downloadMedia } from "./downloadMedia.js";
import { validateData } from "./validateData.js";
import { linkRelatedByCode, makeRedirect } from "./normalise.js";
import { BASE_URL, CONCURRENCY, OUT } from "./config.js";
import type { Product, Category, Page, MediaItem, Redirect, ScrapeReport, Business, Brand, Service } from "./schemas.js";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const LIMIT = opt("--limit") ? Number(opt("--limit")) : undefined;
const DISCOVER_ONLY = flag("--discover-only");
const SKIP_MEDIA = flag("--skip-media");
const DEBUG = flag("--debug");

const dataDir = OUT.data;
const writeJson = (f: string, v: unknown) => fs.writeJson(path.join(dataDir, f), v, { spaces: 2 });

/** Default service add-ons for a local appliance store (prices confirmed with the store). */
const DEFAULT_SERVICES: Service[] = [
  { id: "local-delivery", name: "Local delivery", description: "Delivery within the store's local radius.", price: null, optional: false, category: "delivery" },
  { id: "connection-install", name: "Connection / installation", description: "Connect and test your new appliance.", price: null, optional: true, category: "install" },
  { id: "removal-recycle", name: "Removal & recycling of old appliance", description: "Take away and recycle your old appliance.", price: null, optional: true, category: "disposal" },
  { id: "packaging-removal", name: "Packaging removal", description: "Remove and dispose of all packaging.", price: null, optional: true, category: "disposal" },
  { id: "upstairs-delivery", name: "Upstairs / room-of-choice delivery", description: "Delivery to the room of your choice, including upstairs.", price: null, optional: true, category: "delivery" },
];

async function main() {
  await fs.ensureDir(dataDir);
  const failedUrls: { url: string; error: string }[] = [];
  const notes: string[] = [];

  console.log("1/7  Crawling (respecting robots.txt crawl-delay)…");
  const items = await crawl({ max: LIMIT ? LIMIT * 4 : undefined, onError: (u, e) => failedUrls.push({ url: u, error: e }) });
  const productUrls = items.filter((i) => isProductUrl(i.url)).map((i) => i.url);
  const categoryUrls = items.filter((i) => i.type === "category" || i.type === "brand").map((i) => i.url);
  const contentUrls = items.filter((i) => ["about", "delivery", "contact", "service", "news", "legal", "home"].includes(i.type)).map((i) => i.url);
  await writeJson("discovered-urls.json", items);
  console.log(`     ${items.length} URLs (${productUrls.length} products, ${categoryUrls.length} category/brand, ${contentUrls.length} content)`);
  if (DISCOVER_ONLY) { console.log("Discover-only done."); return; }

  const limit = pLimit(CONCURRENCY);
  const targetProducts = LIMIT ? productUrls.slice(0, LIMIT) : productUrls;

  console.log(`2/7  Products (${targetProducts.length})…`);
  const products = (await Promise.all(targetProducts.map((url) => limit(async () => {
    try {
      const html = await fetchText(url);
      if (DEBUG) await fs.outputFile(path.join("debug", path.basename(url) + ".html"), html);
      return extractProduct(html, url);
    } catch (e) { failedUrls.push({ url, error: String(e) }); return null; }
  })))).filter(Boolean) as Product[];
  linkRelatedByCode(products);

  console.log(`3/7  Categories (${categoryUrls.length})…`);
  const categories = (await Promise.all(categoryUrls.map((url) => limit(async () => {
    try { return extractCategory(await fetchText(url), url); }
    catch (e) { failedUrls.push({ url, error: String(e) }); return null; }
  })))).filter(Boolean) as Category[];
  for (const c of categories) c.productCount = products.filter((p) => p.category === c.name || p.subcategory === c.name).length;

  console.log("4/7  Brands + business + content pages…");
  let brands: Brand[] = [];
  const homeHtml = await fetchText(BASE_URL).catch((e) => { failedUrls.push({ url: BASE_URL, error: String(e) }); return ""; });
  if (homeHtml) brands = extractBrands(homeHtml);
  for (const b of brands) b.productCount = products.filter((p) => p.brand.toLowerCase() === b.name.toLowerCase()).length;

  const pages: Page[] = [];
  const contactHtmls: string[] = [];
  for (const url of contentUrls) {
    try { const html = await fetchText(url); pages.push(extractPage(html, url)); if (/contact|about|delivery/.test(url)) contactHtmls.push(html); }
    catch (e) { failedUrls.push({ url, error: String(e) }); }
  }
  const businessBase = (await fs.pathExists(path.join(dataDir, "business.json"))) ? ((await fs.readJson(path.join(dataDir, "business.json"))) as Business) : {};
  const business = extractBusinessInfo(contactHtmls, businessBase);
  const services = DEFAULT_SERVICES;

  const redirects: Redirect[] = [
    ...products.map((p) => makeRedirect(p.oldUrl, p.newSlug, "product")),
    ...categories.map((c) => makeRedirect(c.slug, `/category${c.slug}`, "category")),
  ];

  const media: MediaItem[] = [];
  for (const p of products) {
    if (p.image) media.push({ sourceUrl: p.image, localPath: "", alt: p.title, pageUrl: p.sourceUrl, type: "product", usedBy: [p.productCode], requiresManualPermissionReview: false });
    for (const g of p.gallery) media.push({ sourceUrl: g, localPath: "", alt: p.title, pageUrl: p.sourceUrl, type: "product", usedBy: [p.productCode], requiresManualPermissionReview: false });
  }
  for (const b of brands) if (b.logo) media.push({ sourceUrl: b.logo, localPath: "", alt: `${b.name} logo`, pageUrl: b.sourceUrl, type: "brand", usedBy: [b.name], requiresManualPermissionReview: true });

  console.log("5/7  Writing data files…");
  await Promise.all([
    writeJson("products.json", products), writeJson("categories.json", categories),
    writeJson("brands.json", brands), writeJson("services.json", services),
    writeJson("pages.json", pages), writeJson("business.json", business),
    writeJson("redirects.json", redirects),
  ]);

  console.log("6/7  Media…");
  const finalMedia = SKIP_MEDIA ? media : await downloadMedia(media);
  await writeJson("media-manifest.json", finalMedia);

  console.log("7/7  Validating + report…");
  const validation = await validateData(dataDir);
  const report: ScrapeReport = {
    scrapedAt: new Date().toISOString(), baseUrl: BASE_URL,
    totalPagesFound: items.length, totalPagesScraped: products.length + categories.length + pages.length,
    totalProducts: products.length, totalCategories: categories.length, totalBrands: brands.length, totalImages: finalMedia.length,
    failedUrls,
    duplicateProducts: validation.errors.filter((e) => e.includes("Duplicate")),
    missingPrices: products.filter((p) => p.priceNow === null).map((p) => p.productCode),
    missingImages: products.filter((p) => !p.image).map((p) => p.productCode),
    missingAvailability: products.filter((p) => p.availabilityNormalised === "unknown").map((p) => p.productCode),
    manualReviewNeeded: finalMedia.filter((m) => m.requiresManualPermissionReview).map((m) => m.sourceUrl),
    notes: [...notes, ...validation.warnings.slice(0, 100)],
  };
  await writeJson("scrape-report.json", report);

  console.log(`\nDone. products=${report.totalProducts} categories=${report.totalCategories} brands=${report.totalBrands} images=${report.totalImages} failed=${failedUrls.length}`);
  console.log(`Validation: ${validation.ok ? "PASS" : "FAIL (" + validation.errors.length + " errors)"} — see scrape-report.json`);
}
main().catch((e) => { console.error(e); process.exit(1); });
