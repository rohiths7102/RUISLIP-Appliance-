/**
 * CSV cell encoding that is safe to open in Excel / Sheets.
 *
 * Quoting alone is not enough: a cell starting with = + - @ (or a leading tab /
 * carriage return) is interpreted as a FORMULA by spreadsheet apps. Enquiry text
 * comes from an unauthenticated public form, so without this an attacker can put
 * a live formula into the owner's own export and have it execute when he opens
 * it. Prefixing with an apostrophe forces the cell to be treated as text.
 */
export function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
