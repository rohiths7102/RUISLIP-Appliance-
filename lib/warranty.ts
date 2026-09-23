/**
 * Warranty cover, worded the way the shop itself advertises it.
 *
 * The strings are not uniform: "5 Year Warranty" sits alongside "1 Year Labour,
 * 10 Year Parts Warranty" and "5 Year Parts & Labour Warranty PLUS a further
 * 5 Year Parts". A badge that printed the first number it found would read
 * "1 YEAR" on the ten-year parts cover, so the short two-line form is used only
 * where the whole string is plainly "N Year Warranty" — everything else keeps
 * its own words.
 */
const PLAIN_YEARS = /^(\d{1,2})\s*years?\s+(?:warranty|guarantee)$/i;

/** Years, but only when the string says nothing else. Otherwise null. */
export function warrantyYears(raw: string): number | null {
  const m = PLAIN_YEARS.exec(raw.replace(/\s+/g, " ").trim());
  return m ? Number(m[1]) : null;
}

/**
 * The admin's warranty template: one wording everywhere, "N Year Warranty",
 * which is exactly what warrantyYears() reads for the badge on the photo.
 */
export const WARRANTY_YEARS = [1, 2, 3, 4, 5, 6, 7, 10];
export const warrantyLabel = (years: number) => `${years} Year Warranty`;

/**
 * A bare number or "N years" ("2", "3 yrs") becomes the template; any other
 * wording ("1 Year Parts and Labour with additional 9 Year Parts Guarantee")
 * is kept exactly as written, because a number would misstate it.
 */
export function normaliseWarranty(raw: string): string {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  const n = t.match(/^(\d{1,2})\s*(?:yrs?|years?)?(?:\s+(?:warranty|guarantee))?$/i);
  return n && Number(n[1]) > 0 ? warrantyLabel(Number(n[1])) : t;
}
