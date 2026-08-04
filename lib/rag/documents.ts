import type { Product, Category, Brand, Business, Service } from "../types";

export interface RagDoc { sourceType: string; sourceId: string; title: string; content: string; metadata: Record<string, any>; }

export function productDoc(p: Product, opts: { omitPrice?: boolean } = {}): RagDoc {
  // Call-for-price categories: the bot must never quote a number the owner
  // deliberately doesn't publish — the doc says "priced by phone" instead.
  const price = opts.omitPrice
    ? "priced by phone — call the store to ask"
    : p.priceNow != null ? `£${p.priceNow}` : "price on request — call to confirm";
  const specs = (p.specifications || []).slice(0, 8).map((s) => `${s.label}: ${s.value}`).join("; ");
  const content = [
    `${p.title} (product code ${p.productCode}) by ${p.brand}.`,
    p.category ? `Category: ${[p.category, p.subcategory].filter(Boolean).join(" > ")}.` : "",
    `Price: ${price}${!opts.omitPrice && p.priceWas ? `, was £${p.priceWas}` : ""}${!opts.omitPrice && p.saving ? `, save £${p.saving}` : ""}. Availability must be confirmed by calling the store.`,
    p.warranty ? `Warranty: ${p.warranty}.` : "",
    p.shortDescription || "",
    specs ? `Specifications: ${specs}.` : "",
    (p.features || []).length ? `Features: ${p.features.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  return { sourceType: "product", sourceId: p.productCode, title: p.title,
    content, metadata: { productCode: p.productCode, brand: p.brand, category: p.category, subcategory: p.subcategory,
      ...(opts.omitPrice ? {} : { priceNow: p.priceNow, priceWas: p.priceWas }), url: p.newSlug, image: p.image } };
}
export function categoryDoc(c: Category): RagDoc {
  return { sourceType: "category", sourceId: c.id, title: c.name, content: `${c.name} category. ${c.description || ""} Browse ${c.name} appliances and call the store to confirm stock.`, metadata: { url: `/categories/${c.id}`, productCount: c.productCount } };
}
export function brandDoc(b: Brand): RagDoc {
  return { sourceType: "brand", sourceId: b.id, title: b.name, content: `${b.name} is one of the brands we stock. We carry ${b.name} kitchen and home appliances.`, metadata: { url: `/brands/${b.slug}` } };
}
export function serviceDoc(s: Service): RagDoc {
  return { sourceType: "service", sourceId: s.id, title: s.name, content: `${s.name}. ${s.description || ""} ${s.price != null ? `Price: £${s.price}.` : "Price confirmed with the store."}`, metadata: { optional: s.optional } };
}
export function businessDocs(b: Business): RagDoc[] {
  const addr = `${b.address.line1}, ${b.address.line2}, ${b.address.county} ${b.address.postcode}`;
  const hours = Object.entries(b.openingHours).map(([d, h]) => `${d}: ${h}`).join(", ");
  return [
    { sourceType: "business", sourceId: "contact", title: "Store contact & location", content: `${b.businessName} (trading as ${b.tradingName}) is a family-run appliance store established in 1977. Address: ${addr}. Phone: ${b.phone}. The website is an extension of the physical store.`, metadata: { phone: b.phone, url: "/contact" } },
    { sourceType: "business", sourceId: "hours", title: "Opening hours", content: `Opening hours — ${hours}.`, metadata: { url: "/contact" } },
    { sourceType: "business", sourceId: "delivery", title: "Delivery", content: `Delivery is local, within ${b.delivery.radius || "the local area"}. Delivery must be confirmed with the store; same-day delivery is subject to stock and location. ${b.delivery.notes || ""}`, metadata: { url: "/delivery-services" } },
  ];
}
export function faqDocs(b: Business): RagDoc[] {
  const faq = (id: string, title: string, content: string): RagDoc => ({ sourceType: "faq", sourceId: id, title, content, metadata: { url: "/contact" } });
  return [
    faq("how-to-buy", "How to buy", `This is a phone-first store — there is no online checkout, basket or payment. Browse products online, then call ${b.phone} to confirm availability and price, and to arrange payment, delivery and fitting. Quote the product code when you call.`),
    faq("payment", "Payment", `Payment is arranged directly with the store, by phone or in person — not online.`),
    faq("installation", "Installation & fitting", `Installation and fitting services are available, along with removal and recycling of your old appliance. Ask in store for details and pricing.`),
    faq("availability", "Stock & availability", `Most items shown are usually in stock, but availability is always confirmed by phone. Please call ${b.phone} to check live stock before travelling.`),
  ];
}
export function buildDocuments(cat: { products: Product[]; categories: Category[]; brands: Brand[]; business: Business; services: Service[] }): RagDoc[] {
  const poa = new Set(cat.categories.filter((c) => c.priceOnApplication).map((c) => c.name));
  return [
    ...cat.products.map((p) => productDoc(p, { omitPrice: poa.has(p.category) || poa.has(p.subcategory) })),
    ...cat.categories.map(categoryDoc), ...cat.brands.map(brandDoc),
    ...cat.services.map(serviceDoc), ...businessDocs(cat.business), ...faqDocs(cat.business),
  ];
}
