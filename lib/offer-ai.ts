import { callGemini, callGeminiImage, callGroq } from "@/lib/chat/groq";

/**
 * Admin → Offers: fill in a banner for the owner to check. The AI reads the
 * banner picture when it can (Gemini; Groq has no vision), else the few words
 * he typed, and writes the description and picks the page it should open — but
 * only from the shop's real pages: a page the AI invents is replaced by a brand
 * or department named in the text, else the whole range. Nothing goes live
 * until he saves.
 */
export type OfferPage = { href: string; label: string };
export type OfferSuggestion = { alt: string; href: string; via: "picture" | "text" | "rules" };

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The model's page if it is one of ours; else a brand/department named in `text` (longest name first); else all products. */
export function pickPage(choice: string, text: string, pages: OfferPage[]): string {
  const hit = pages.find((p) => p.href === String(choice || "").trim());
  if (hit) return hit.href;
  const t = ` ${norm(text)} `;
  const named = [...pages].sort((a, b) => b.label.length - a.label.length).find((p) => norm(p.label) && t.includes(` ${norm(p.label)} `));
  return named?.href ?? "/products";
}

const ask = (pages: OfferPage[], what: string) =>
  `You are filling in a homepage offer banner for a UK appliance shop (Euronics Ruislip). ${what}
Reply with JSON only: {"description": "...", "page": "..."}.
- description: one line, at most 140 characters, saying what the banner offers, e.g. "Liebherr — 10-year guarantee on all household appliances". Only claims the banner or the owner actually make: never add scope ("all", "every"), prices, dates or conditions they don't state.
- page: the ONE page below the banner should open, copied exactly:
${pages.map((p) => `${p.href} = ${p.label}`).join("\n")}`;

function parse(reply: string): { description: string; page: string } | null {
  try {
    const j = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] || "");
    const description = String(j.description || "").replace(/\s+/g, " ").trim().slice(0, 160);
    return description ? { description, page: String(j.page || "") } : null;
  } catch { return null; }
}

export async function suggestOffer(input: { image?: { mime: string; b64: string }; hint: string; pages: OfferPage[] }): Promise<OfferSuggestion> {
  const { image, hint, pages } = input;
  if (image && process.env.GEMINI_API_KEY) {
    try {
      const r = parse(await callGeminiImage(ask(pages, `Read the banner picture${hint ? ` (the owner adds: "${hint}")` : ""}.`), image, 20000));
      if (r) return { alt: r.description, href: pickPage(r.page, `${r.description} ${hint}`, pages), via: "picture" };
    } catch { /* fall back to the words */ }
  }
  if (hint) {
    try {
      const msgs = [{ role: "user" as const, content: ask(pages, `The owner describes the banner as: "${hint}".`) }];
      const r = parse(process.env.GROQ_API_KEY ? await callGroq(msgs, { maxTokens: 300 }) : await callGemini(msgs, 20000));
      if (r) return { alt: r.description, href: pickPage(r.page, `${r.description} ${hint}`, pages), via: "text" };
    } catch { /* fall back to rules */ }
  }
  return { alt: hint.slice(0, 160), href: pickPage("", hint, pages), via: "rules" };
}
