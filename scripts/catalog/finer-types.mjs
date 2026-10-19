/**
 * Sachin's finer types (Oct 2026), for anything classified from now on. The
 * taxonomy's classify() picks the broad type (washing machine, hob, oven…);
 * this narrows it from the product's own title and, where the maker gave it,
 * its "Built-in / Free-standing" spec — the same rules split-types.mjs used to
 * re-file the catalogue on 17 Oct 2026, so new imports land where the rest did.
 * A product with no signal keeps the broad type's main finer type.
 */
const spec = (specs, label) => {
  const sp = Array.isArray(specs) ? specs : [];
  return String(sp.find((x) => x && (x.label === label || x.name === label))?.value ?? "");
};

// Fitted into a kitchen run? A maker's spec wins; then the title.
function fitted(title, specs) {
  const s = spec(specs, "Built-in / Free-standing").toLowerCase();
  if (s.startsWith("built")) return true;
  if (s.startsWith("free")) return false;
  if (/\bfree[- ]?standing\b/i.test(title)) return false;
  return /\b(fully[- ]?integrated|semi[- ]?integrated|integrated|integrable|built[- ]?in|built[- ]?under)\b/i.test(title);
}

function dishwasher(t, specs) {
  if (/table ?top|countertop|compact dishwasher/i.test(t)) return "freestanding-dishwashers";
  const slim = /slimline|\b45 ?cm\b/i.test(t);
  if (/semi[- ]?integrated/i.test(t) || /semi/i.test(spec(specs, "Installation typology"))) return "semi-integrated-dishwashers";
  if (fitted(t, specs)) return slim ? "integrated-slimline-dishwashers" : "integrated-dishwashers";
  return slim ? "slimline-dishwashers" : "freestanding-dishwashers";
}

const RULES = {
  "washing-machines": (t, s) => (fitted(t, s) ? "integrated-washing-machines" : "washing-machines"),
  "washer-dryers": (t, s) => (fitted(t, s) ? "integrated-washer-dryers" : "washer-dryers"),
  "fridge-freezers": (t, s) => (fitted(t, s) ? "integrated-fridge-freezers" : "fridge-freezers"),
  "fridges": (t, s) => (fitted(t, s) ? "integrated-fridges" : "fridges"),
  "freezers": (t, s) => {
    if (/\bchest\b/i.test(t)) return "chest-freezers";
    if (/\bfridge\b/i.test(t) && !/fridge[- ]?freezer/i.test(t)) return fitted(t, s) ? "integrated-fridges" : "fridges";
    return fitted(t, s) ? "integrated-freezers" : "freezers";
  },
  "freestanding-dishwashers": dishwasher,
  "integrated-dishwashers": dishwasher,
  "ovens": (t, s) => {
    if (/warming drawer/i.test(t)) return "warming-drawers";
    if (/microwave/i.test(t)) return "microwaves";
    const two = /\bdouble\b/i.test(t) || spec(s, "Usable volume (of cavity) - cavity 2") !== "";
    if (two && /built[- ]?under/i.test(t)) return "built-under-ovens";
    if (two) return "double-ovens";
    if (/\bcompact\b|\b45 ?cm\b/i.test(t)) return "compact-ovens";
    return "ovens";
  },
  "hobs": (t) => {
    if (/venting|extract|downdraft|with integrated (hood|extractor)/i.test(t)) return "venting-hobs";
    if (/dual fuel|\bgas\b|\blpg\b|\bwok\b/i.test(t)) return "gas-hobs";
    if (/induction/i.test(t)) return "hobs";
    if (/ceramic|electric|solid plate|radiant|hi-?light/i.test(t)) return "ceramic-hobs";
    return "hobs";
  },
  "gas-hobs": (t) => (/venting|extract|downdraft/i.test(t) ? "venting-hobs" : "gas-hobs"),
  "cookers": (t) => (/\brange\b|\b(90|100|110|120) ?cm\b/i.test(t) ? "range-cookers" : "cookers"),
  "kitchen-sinks": (t) => (/granite|composite|quartz|silgranit|tectonite|cristalite/i.test(t) ? "granite-sinks" : /ceramic|belfast|fireclay|butler/i.test(t) ? "ceramic-sinks" : "kitchen-sinks"),
  "kitchen-taps": (t) => (/boiling/i.test(t) ? "boiling-water-taps" : /pull[- ]?(out|down)|spray/i.test(t) ? "pull-out-taps" : /filter/i.test(t) ? "filter-taps" : "kitchen-taps"),
  "vacuum-cleaners": (t) => (/\bcordless\b/i.test(t) ? "cordless-vacuums" : "vacuum-cleaners"),
};

/** The finer type id for a broad one, from the product's title and specs. */
export function finerType(leaf, title, specs) {
  const rule = RULES[leaf];
  return rule ? rule(String(title || ""), specs) : leaf;
}
