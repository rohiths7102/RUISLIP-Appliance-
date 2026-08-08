/**
 * Build a customer-facing product title from a catalogue drop record.
 *
 * The drops carry two text fields and only one of them is a name:
 *   "name":        "Blomberg FND479P"          <- the brand and the model code
 *   "description": "FND479P Blomberg Freestanding Frost Free Tall Freezer - White
 *                   - 191.2cm x 70cm x 81.3cm - E Energy"
 *
 * Taking the title from "name" is what produced 288 products whose title was
 * nothing but their brand, so a listing page showed the word "Smeg" a hundred
 * times over. The real name lives inside "description", prefixed by the code and
 * often repeating the brand, so it has to be reassembled: strip the code, keep
 * exactly one leading brand, and drop the dimension and energy clauses the site
 * already renders from its own fields.
 */

/** Escape a value that is about to be interpolated into a RegExp. Brand and code
 *  come from supplier folder names — "WAU28T64GB(B)" would otherwise throw. */
export const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Trailing clauses the storefront renders from its own data, not the title. */
const NOISE = [
  /^\d+(\.\d+)?\s*cm(\s*x\s*\d+(\.\d+)?\s*cm)+$/i, // 191.2cm x 70cm x 81.3cm
  /^[A-G]\+{0,3}\s*Energy$/i,                      // E Energy
  /^Energy\s*(Rating|Class)?\s*[A-G]\+{0,3}$/i,
];

const clean = (s) => String(s || "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/**
 * @param {{name?: string, description?: string}} record  the drop's product.json
 * @param {string} brand  folder/brand name, already canonicalised by the caller
 * @param {string} code   product code (upper-cased)
 * @returns {string} a title, never empty and never just the brand
 */
export function buildTitle(record, brand, code) {
  const fallback = clean(`${brand} ${code}`);
  const description = clean(record?.description);
  const name = clean(record?.name);

  // Prefer whichever field actually describes the appliance. "Blomberg FND479P"
  // carries no information once the brand and code are removed, so it loses to
  // the description even though it is the nominal name field.
  const informative = (s) => clean(stripCode(stripBrand(s, brand), code)).length > 0;
  let text = informative(description) ? description : informative(name) ? name : "";
  if (!text) return fallback;

  text = stripCode(text, code);

  // The brand may appear once, twice, or not at all; normalise to exactly one at
  // the front so cards read "Blomberg Frost Free Tall Freezer", never "Blomberg
  // Blomberg …" and never a bare model description with no maker.
  text = clean(stripBrand(text, brand));
  text = text ? `${brand} ${text}` : "";

  text = dropNoiseClauses(text);
  text = clean(text.replace(/^[\s\-–—,:;|]+|[\s\-–—,:;|]+$/g, ""));

  // A title equal to the brand is the exact defect this function exists to
  // prevent — fall back to something a customer can quote on the phone.
  if (!text || text.toLowerCase() === brand.toLowerCase()) return fallback;
  return capLength(text, 110);
}

/** Remove every occurrence of the model code, wherever the supplier put it. */
function stripCode(s, code) {
  if (!code) return s;
  return clean(String(s).replace(new RegExp(`(^|[\\s\\-–—(\\[,:])${reEscape(code)}(?=$|[\\s\\-–—)\\],:.])`, "gi"), " "));
}

/** Remove leading/repeated brand mentions; the caller re-adds one at the front. */
function stripBrand(s, brand) {
  if (!brand) return s;
  return clean(String(s).replace(new RegExp(`(^|[\\s\\-–—(\\[,:])${reEscape(brand)}(?=$|[\\s\\-–—)\\],:.])`, "gi"), " "));
}

/** Drop " - 191.2cm x 70cm x 81.3cm" / " - E Energy" style tails. */
function dropNoiseClauses(s) {
  const parts = String(s).split(/\s+[-–—]\s+/);
  const kept = parts.filter((p, i) => i === 0 || !NOISE.some((re) => re.test(p.trim())));
  return kept.join(" - ");
}

/** Trim to a length that fits a card, preferring a clause boundary. */
function capLength(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf(" - "), cut.lastIndexOf(", "), cut.lastIndexOf(" "));
  return clean(boundary > max * 0.6 ? cut.slice(0, boundary) : cut);
}
