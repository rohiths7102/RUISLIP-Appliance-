/**
 * Everyday wording → the catalogue's own terms, for the chatbot's finder
 * (lib/chat/finder.ts): a price ceiling, and a department name.
 *
 * Why the finder asks the database rather than a keyword index: BM25 has no
 * idea what a price is. Asked "washing machines under 500" it scored the words
 * "washing"/"machine" and returned Bosch SPARE PART documents, and the model
 * correctly answered "we don't have any under £500". The shop has 51, from
 * £239.99. A confidently wrong "we don't stock that" is worse than no chatbot:
 * it turns a buyer away.
 */

/** "under £500", "below 400", "less than £1,000", "up to 750", "£500 budget" */
export function parsePriceCap(q: string): number | null {
  const s = q.toLowerCase().replace(/,/g, "");
  const m =
    s.match(/(?:under|below|less than|cheaper than|max|maximum|up to|within|no more than)\s*£?\s*(\d{2,6})/) ||
    s.match(/£\s*(\d{2,6})\s*(?:or less|budget|max)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 20 && n <= 100000 ? n : null;
}

/**
 * Map everyday wording to the catalogue's own subcategory/category names.
 * Longest phrases first so "washer dryer" is not eaten by "washer".
 */
const TERMS: [RegExp, string][] = [
  [/\bwasher[- ]?dryers?\b/, "Washer Dryers"],
  [/\bwashing machines?\b|\bwashers?\b/, "Washing Machines"],
  [/\btumble dryers?\b|\bdryers?\b/, "Tumble Dryers"],
  [/\bamerican([- ]style)? fridge[- ]?freezers?\b|\bside[- ]by[- ]side\b/, "American Style Fridge Freezers"],
  [/\bfridge[- ]?freezers?\b/, "Fridge Freezers"],
  [/\bwine (coolers?|cabinets?|fridges?)\b|\bwine coolers?\b/, "Wine Coolers"],
  [/\bfreezers?\b/, "Freezers"],
  [/\bfridges?\b|\brefrigerators?\b/, "Fridges"],
  [/\b(integrated|built[- ]?in) dishwashers?\b/, "Integrated Dishwashers"],
  [/\b(freestanding|free[- ]standing) dishwashers?\b/, "Freestanding Dishwashers"],
  [/\bdishwashers?\b/, "Dishwashers"],
  [/\brange cookers?\b|\bcookers?\b/, "Cookers"],
  [/\bovens?\b/, "Ovens"],
  [/\bwarming drawers?\b/, "Warming Drawers"],
  [/\bhobs?\b|\bcooktops?\b/, "Hobs"],
  [/\bmicrowaves?\b/, "Microwaves"],
  [/\b(cooker )?hoods?\b|\bextractors?\b/, "Cooker Hoods & Extractors"],
  [/\btvs?\b|\btelevisions?\b/, "Televisions"],
  [/\bsoundbars?\b|\bspeakers?\b/, "Soundbars & Speakers"],
  [/\bcordless vacuums?\b|\bstick vacuums?\b/, "Cordless Vacuums"],
  [/\brobot vacuums?\b|\brobo(t)? cleaners?\b/, "Robot Vacuums"],
  [/\bvacuums?\b|\bhoovers?\b/, "Vacuum Cleaners"],
  [/\bbean[- ]to[- ]cup\b|\bespresso machines?\b/, "Bean to Cup & Espresso"],
  [/\bcoffee machines?\b/, "Coffee Machines"],
  [/\bair fryers?\b|\bmulti[- ]?cookers?\b/, "Air Fryers & Multi Cookers"],
  [/\bkettles?\b/, "Kettles"],
  [/\btoasters?\b/, "Toasters"],
  // Sinks & Taps is newer than this table, so the department was invisible here:
  // "do you have kitchen sinks?" matched nothing, fell through to BM25 and was
  // answered "no" over 178 of them. Boiling-water first -- a Quooker is not a
  // mixer tap -- and sink before tap, the same order taxonomy.mjs uses.
  [/\bboiling water taps?\b|\binstant hot water taps?\b|\bsteaming (hot )?water taps?\b|\bquooker\b/, "Boiling Water Taps"],
  [/\bsinks?\b/, "Kitchen Sinks"],
  [/\btaps?\b/, "Kitchen Taps"],
];

export function parseCategory(q: string): string | null {
  const s = q.toLowerCase();
  for (const [re, name] of TERMS) if (re.test(s)) return name;
  return null;
}
