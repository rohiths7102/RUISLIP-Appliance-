export const SITE = () => process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
export function breadcrumbJsonLd(items: { name: string; url?: string }[]) {
  const base = SITE();
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, ...(it.url ? { item: base + it.url } : {}) })) };
}
export function faqJsonLd(faqs: { q: string; a: string }[]) {
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
}
export function jsonLdScript(data: unknown) {
  return { __html: JSON.stringify(data) };
}
