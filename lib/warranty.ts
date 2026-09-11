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
