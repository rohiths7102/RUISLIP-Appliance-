export const SITE = () => process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
export function breadcrumbJsonLd(items: { name: string; url?: string }[]) {
  const base = SITE();
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, ...(it.url ? { item: base + it.url } : {}) })) };
}
export function faqJsonLd(faqs: { q: string; a: string }[]) {
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
}
/**
 * Serialise structured data for a <script type="application/ld+json"> block.
 *
 * JSON.stringify does NOT escape "<", so any catalogue string containing
 * "</script>" (supplier feeds and admin-editable copy both reach here) would
 * close the element early and turn the rest into executable HTML. Escaping the
 * three characters that can start a tag or a comment keeps the JSON byte-identical
 * to parsers while making breakout impossible.
 */
export function jsonLdScript(data: unknown) {
  return { __html: safeJsonLd(data) };
}

export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
