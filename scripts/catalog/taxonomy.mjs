/**
 * Canonical category tree for the Euronics Ruislip catalogue.
 *
 * Every product in the three source catalogues (bosch, neff, ruislip) resolves to
 * exactly one leaf here. Nothing is allowed to fall through — `classify()` throws
 * rather than silently dumping a product into a bucket it doesn't belong in.
 *
 * Top-level ids are what the customer browses; leaves are what they filter by.
 */

export const TREE = [
  { id: "laundry", name: "Laundry", blurb: "Washing machines, washer dryers and tumble dryers from the brands we stock and service.", children: [
    { id: "washing-machines", name: "Washing Machines" },
    { id: "washer-dryers", name: "Washer Dryers" },
    { id: "tumble-dryers", name: "Tumble Dryers" },
  ]},
  { id: "refrigeration", name: "Refrigeration", blurb: "Fridge freezers, American-style, integrated fridges, freezers and wine coolers.", children: [
    { id: "fridge-freezers", name: "Fridge Freezers" },
    { id: "american-fridge-freezers", name: "American Style Fridge Freezers" },
    { id: "fridges", name: "Fridges" },
    { id: "freezers", name: "Freezers" },
    { id: "wine-coolers", name: "Wine Coolers" },
  ]},
  { id: "dishwashers", name: "Dishwashers", blurb: "Integrated and freestanding dishwashers, fitted by our own team.", children: [
    { id: "integrated-dishwashers", name: "Integrated Dishwashers" },
    { id: "freestanding-dishwashers", name: "Freestanding Dishwashers" },
  ]},
  { id: "cooking", name: "Cooking", blurb: "Ovens, hobs, cookers, microwaves, extractor hoods and warming drawers.", children: [
    { id: "ovens", name: "Ovens" },
    { id: "hobs", name: "Hobs" },
    { id: "cookers", name: "Cookers" },
    { id: "microwaves", name: "Microwaves" },
    { id: "cooker-hoods", name: "Cooker Hoods & Extractors" },
    { id: "warming-drawers", name: "Warming Drawers" },
  ]},
  // The owner sells Caple sinks/taps and the full Quooker boiling-water range,
  // neither of which is an "appliance" — they had nowhere to live and would have
  // been thrown out by classify() rather than guessed at.
  { id: "sinks-taps", name: "Sinks & Taps", blurb: "Kitchen sinks, mixer taps and boiling water taps, supplied and fitted.", children: [
    { id: "kitchen-sinks", name: "Kitchen Sinks" },
    { id: "kitchen-taps", name: "Kitchen Taps" },
    { id: "boiling-water-taps", name: "Boiling Water Taps" },
  ]},
  { id: "coffee-machines", name: "Coffee Machines", blurb: "Bean-to-cup, filter, pod machines and grinders.", children: [
    { id: "bean-to-cup", name: "Bean to Cup & Espresso" },
    { id: "tassimo", name: "Tassimo & Pod Machines" },
    { id: "filter-coffee", name: "Filter Coffee Machines" },
    { id: "coffee-grinders", name: "Coffee Grinders" },
  ]},
  { id: "floorcare", name: "Floorcare", blurb: "Vacuum cleaners, cordless sticks, robots and hard floor cleaners.", children: [
    { id: "vacuum-cleaners", name: "Vacuum Cleaners" },
    { id: "cordless-vacuums", name: "Cordless Vacuums" },
    { id: "robot-vacuums", name: "Robot Vacuums" },
    { id: "floor-cleaners", name: "Hard Floor Cleaners" },
  ]},
  { id: "small-appliances", name: "Small Appliances", blurb: "Kettles, toasters, blenders, air fryers, grills and everything on the worktop.", children: [
    { id: "kettles", name: "Kettles" },
    { id: "toasters", name: "Toasters" },
    { id: "blenders", name: "Blenders" },
    { id: "food-prep", name: "Food Prep & Kitchen Machines" },
    { id: "air-fryers-multi-cookers", name: "Air Fryers & Multi Cookers" },
    { id: "grills-bbq", name: "Grills & BBQ" },
    { id: "coolers", name: "Cool Boxes" },
    { id: "cookware", name: "Cookware" },
  ]},
  { id: "tv-audio", name: "TV & Audio", blurb: "Televisions, soundbars and players.", children: [
    { id: "televisions", name: "Televisions" },
    { id: "soundbars-speakers", name: "Soundbars & Speakers" },
    { id: "blu-ray-players", name: "Blu-ray & DVD Players" },
  ]},
  { id: "accessories-parts", name: "Accessories & Spare Parts", blurb: "Genuine accessories, filters, cleaning products and spare parts to order.", children: [
    { id: "cooking-accessories", name: "Oven & Cooking Accessories" },
    { id: "hob-accessories", name: "Hob Accessories" },
    { id: "cooker-hood-accessories", name: "Hood Filters & Accessories" },
    { id: "laundry-accessories", name: "Laundry Accessories" },
    { id: "refrigeration-accessories", name: "Refrigeration Accessories" },
    { id: "dishwasher-accessories", name: "Dishwasher Accessories" },
    { id: "vacuum-accessories", name: "Vacuum Bags & Accessories" },
    { id: "coffee-accessories", name: "Coffee Machine Accessories" },
    { id: "kitchen-machine-accessories", name: "Kitchen Machine Accessories" },
    { id: "kitchen-utensils", name: "Kitchen Utensils" },
    { id: "cleaning-products", name: "Cleaning & Care Products" },
    { id: "spare-parts", name: "Spare Parts" },
  ]},
];

/** leafId -> { leafId, leafName, topId, topName } */
export const LEAF = new Map();
for (const t of TREE) for (const c of t.children) {
  LEAF.set(c.id, { leafId: c.id, leafName: c.name, topId: t.id, topName: t.name });
}
export const TOP = new Map(TREE.map((t) => [t.id, t]));

/* ------------------------------------------------------------------ *
 * BOSCH / NEFF — the real taxonomy lives in source_url, not the folder
 * name. `bosch/Cooking` is 340 items but most are lamps and baking trays.
 * Key is "<cat>/<subcat>" taken from /…/product/<cat>/<subcat>/<model>.
 * ------------------------------------------------------------------ */
export const URL_MAP = {
  // --- bosch ---
  "cooking/cooking-baking-accessories": "cooking-accessories",
  "cooking/cooker-hoods": "cooker-hoods",
  "cooking/ovens": "ovens",
  "cooking/induction-electric-hobs": "hobs",
  "cooking/gas-hobs": "hobs",
  "cooking/microwaves": "microwaves",
  "cooking/warming-drawers": "warming-drawers",
  "cooking/cleaning-and-care": "cleaning-products",
  "kitchen-machines/kitchen-machine-accessories": "kitchen-machine-accessories",
  "kitchen-machines/mum-kitchen-machines": "food-prep",
  "kitchen-machines/food-processors": "food-prep",
  "vacuum-cleaners/vacuum-cleaner-accessories": "vacuum-accessories",
  "vacuum-cleaners/accessories-cordless": "vacuum-accessories",
  "vacuum-cleaners/cordless-vacuum-cleaners": "cordless-vacuums",
  "vacuum-cleaners/bagged-vacuum-cleaners": "vacuum-cleaners",
  "vacuum-cleaners/bagless-vacuum-cleaners": "vacuum-cleaners",
  "vacuum-cleaners/cleaning-robots": "robot-vacuums",
  "fridges-freezers/fridge-freezers": "fridge-freezers",
  "fridges-freezers/fridge-freezer-accessories": "refrigeration-accessories",
  "fridges-freezers/fridges": "fridges",
  "fridges-freezers/freezers": "freezers",
  "fridges-freezers/wine-fridges": "wine-coolers",
  "fridges-freezers/american-style": "american-fridge-freezers",
  "cleaning-and-care/active-carbon-filters-for-extractor-hoods": "cooker-hood-accessories",
  "cleaning-and-care/cleaning-products": "cleaning-products",
  "cleaning-and-care/descalers": "cleaning-products",
  "cleaning-and-care/dustbags": "vacuum-accessories",
  "cleaning-and-care/water-filters": "refrigeration-accessories",
  "small-appliances/toasters": "toasters",
  "small-appliances/kettles": "kettles",
  "small-appliances/airfryer": "air-fryers-multi-cookers",
  "small-appliances/blenders": "blenders",
  "small-appliances/hand-blenders": "blenders",
  "small-appliances/hand-mixers": "food-prep",
  "small-appliances/accessories": "kitchen-machine-accessories",
  "laundry/washing-machine-dryer-accessories": "laundry-accessories",
  "laundry/washing-machines": "washing-machines",
  "laundry/tumble-dryers": "tumble-dryers",
  "laundry/washer-dryers": "washer-dryers",
  "dishwashers/freestanding-dishwashers": "freestanding-dishwashers",
  "dishwashers/built-in-dishwashers": "integrated-dishwashers",
  "coffee-machines/tassimo-hot-drinks-machines": "tassimo",
  "coffee-machines/accessories": "coffee-accessories",
  "coffee-machines/filter-coffee-machines": "filter-coffee",
  "coffee-machines/coffee-grinders": "coffee-grinders",
  "coffee-machines/built-in-fully-automatic-coffee-machines": "bean-to-cup",
  "hc/coffee": "bean-to-cup",

  // --- neff ---
  "accessories/cooker-hoods": "cooker-hood-accessories",
  "accessories/cookers-ovens": "cooking-accessories",
  "accessories/hobs": "hob-accessories",
  "accessories/kitchen-utensils": "kitchen-utensils",
  "accessories/dishwasher": "dishwasher-accessories",
  "accessories/cooling": "refrigeration-accessories",
  "accessories/steam-ovens": "cooking-accessories",
  "accessories/coffee-machines": "coffee-accessories",
  "accessories/microwaves": "cooking-accessories",
  "fridges-freezers/wine-coolers": "wine-coolers", // neff spells it "wine-coolers"; bosch uses "wine-fridges"
  "hobs/induction-hobs": "hobs",
  "hobs/gas-hobs": "hobs",
  "hobs/ceramic-hobs": "hobs",
  "ovens-compact-ovens/ovens": "ovens",
  "ovens-compact-ovens/compact-ovens": "ovens",
  "extractor-hoods/wall-installation": "cooker-hoods",
  "extractor-hoods/integrated-furniture-installation": "cooker-hoods",
  "microwaves/compact-microwave": "microwaves",
  "drawers/warming-drawers": "warming-drawers",
  "dishwashers/fully-integrated-dishwashers": "integrated-dishwashers",
  "laundry/washer-dryer": "washer-dryers",
  "cleaning-products/cookers-ovens": "cleaning-products",
  "cleaning-products/coffee-machines": "cleaning-products",
  "cleaning-products/dishwashing": "cleaning-products",
  "cleaning-products/hobs": "cleaning-products",
  "cleaning-products/laundry": "cleaning-products",
  "cleaning-products/cooling-freezing": "cleaning-products",
};

/* ------------------------------------------------------------------ *
 * RUISLIP — no taxonomy at all: `category` is just the brand folder, so
 * the product type only exists in free text. Ordered rules, first match
 * wins. Order is load-bearing; see the collisions called out below.
 * ------------------------------------------------------------------ */
export const TEXT_RULES = [
  // Accessories first — "Vacuum Cleaner Bags" is not a vacuum cleaner.
  [/vacuum cleaner bags|hyclean/i, "vacuum-accessories"],
  [/filter cassette|recirculating filter/i, "cooker-hood-accessories"],
  [/scale control/i, "cleaning-products"],

  // TV & audio before anything else — "LED"/"Smart" collide with appliances,
  // so match only TV-specific tokens (never bare "led"/"smart").
  [/blu-?ray|dvd player/i, "blu-ray-players"],
  [/soundbar|neckband speaker|dolby atmos/i, "soundbars-speakers"],
  [/\b(4k|oled|qled|nanocell|qned|bravia|hd ready)\b|smart tv|led tv|google tv/i, "televisions"],

  // "Cooler" collides three ways: FrostVault cool box vs wine cooler vs fridge.
  [/frostvault|cooler with dry zone|wheeled cooler|hard cooler/i, "coolers"],
  [/wine cooler|wine cabinet|wine fridge|vinidor/i, "wine-coolers"],
  // Boiling-water first: a Quooker is a "boiling water tap", and the plain
  // /tap/ rule below would otherwise claim it. Sink before tap, because a
  // "sink and tap pack" is bought as a sink.
  [/boiling water tap|instant hot water tap|\bquooker\b|\b100\s*°?c\s*tap/i, "boiling-water-taps"],
  [/\bsink\b|undermount bowl|inset bowl|belfast|drainer/i, "kitchen-sinks"],
  [/\btaps?\b|mixer tap|monobloc|pull[- ]out spray/i, "kitchen-taps"],

  // Countertop cooking before built-in — a Ninja "Multifunction Oven" is not an oven,
  // and a "Multi-Cooker" is not a cooker.
  [/bbq|smoker|outdoor cooking/i, "grills-bbq"],
  [/\bwok\b|cookware|frying pan/i, "cookware"],
  [/toaster/i, "toasters"],
  [/kettle/i, "kettles"],
  // A SLUSHi frozen-drink maker chills and churns; it neither air-fries nor cooks.
  [/blender|nutribullet|slushi|frozen drink/i, "blenders"],
  // "Air fryer" the noun is a worktop machine; "AirFry" the FEATURE appears on
  // built-in Miele/Hotpoint ovens — matching bare "air fry" files a £1,399 oven
  // under Small Appliances. Require the noun.
  [/air ?fryer|air-grill|multi[- ]?cooker|possiblecooker|mini oven|multifunction oven|flip mini|speedi|one lid/i, "air-fryers-multi-cookers"],
  [/hand mixer|food processor|stand mixer/i, "food-prep"],
  [/espresso|bean to cup|coffee/i, "bean-to-cup"],

  // Floorcare
  [/floor cleaner|hydrovac|steampickup/i, "floor-cleaners"],
  [/cordless.*vacuum|stick vacuum|handstick/i, "cordless-vacuums"],
  [/vacuum/i, "vacuum-cleaners"],

  // Laundry — washer-dryer before washing machine. "9kg/5kg" (a wash load and a
  // dry load) is the giveaway for a washer dryer that never names itself.
  [/washer[- ]?dryer|wash tower|\d+\s*kg\s*\/\s*\d+\s*kg/i, "washer-dryers"],
  [/washing machine/i, "washing-machines"],
  [/tumble dryer|heat pump dryer|condenser dryer|sensidry|heat pump.*dryer|\bdryer\b/i, "tumble-dryers"],
  // Last-resort laundry: "11kg 1400 spin - White" names no product type at all.
  // Runs after tumble dryers so a "9kg ... Dryer" can never land here.
  [/\d+\s*kg\b.*\bspin\b/i, "washing-machines"],

  [/dishwasher/i, "__DISHWASHER__"],

  // Refrigeration — American/multi-door before plain fridge freezer.
  [/american|side by side|french door|quad door|multi-?door/i, "american-fridge-freezers"],
  [/fridge[- ]?freezer|refrigerator freezer/i, "fridge-freezers"],
  [/chest freezer|\bfreezer\b/i, "freezers"],
  [/\bfridge\b|refrigerator|larder/i, "fridges"],

  // Built-in cooking. Cooker BEFORE hob: "Double Oven Electric Cooker with
  // Ceramic Hob" is a cooker. Extractor BEFORE hob: "Hob Extractor" is a hood.
  [/warming drawer/i, "warming-drawers"],
  [/\bhood\b|extractor/i, "cooker-hoods"],
  [/cooker/i, "cookers"],
  [/\bhob\b|cooktop/i, "hobs"],
  [/microwave/i, "microwaves"],
  [/\boven\b/i, "ovens"],
];

/* ------------------------------------------------------------------ *
 * CONTENT REFINEMENT
 *
 * Bosch and Neff are the same BSH parts catalogue published under two brands:
 * 224 part numbers appear in both feeds, and each feed files them under its own
 * URL taxonomy. Trusting the URL alone therefore puts the SAME part in two
 * different leaves — a Mepal storage bowl is "cooking-baking-accessories" to
 * Bosch and "kitchen-utensils" to Neff; hood ducting is "cleaning-and-care" to
 * Bosch and "hobs" to Neff.
 *
 * These rules run on the product text, which is identical in both feeds, so the
 * twins always converge. They are applied ONLY to products the base pass already
 * placed inside Accessories & Spare Parts, so a real appliance can never be
 * dragged in here by a stray keyword.
 * ------------------------------------------------------------------ */
export const ACCESSORY_LEAVES = new Set([
  "cooking-accessories", "hob-accessories", "cooker-hood-accessories", "laundry-accessories",
  "refrigeration-accessories", "dishwasher-accessories", "vacuum-accessories", "coffee-accessories",
  "kitchen-machine-accessories", "kitchen-utensils", "cleaning-products", "spare-parts", "cookware",
]);

export const ACCESSORY_RULES = [
  // Vacuum first: "for vacuum cleaners" would otherwise trip the /cleaner/ in the
  // chemistry rule below.
  [/dust ?bag|vacuum/i, "vacuum-accessories"],
  // Consumable chemistry goes to Cleaning & Care whatever appliance it serves;
  // hardware (filters, jugs, pans) goes to that appliance's accessories.
  [/descal|cleaning tablet|cleaning agent|detergent|rinse aid|freshener|test strip|cleaning cloth|care product/i, "cleaning-products"],
  // Parts that sit ON a hob, before the cookware rule claims them.
  [/wok ring|teppan|lava stone|twistpad|griddle plate|hob cover|hob connecting|connecting strip/i, "hob-accessories"],
  // BSH "Pro Induction" pan line. A "Wok Ring" is a hob part; a "Wok" is cookware.
  // Deliberately NOT matching bare /pan/ — "universal pan" and "baking pan" are bakeware.
  [/pro induction|frying pan|casserole|saucepan|stock ?pot|espresso maker|pasta.*inlay|pan set|berghoff|cookware|\bwok\b(?! ?ring)/i, "cookware"],
  // Probes and bakeware belong to the oven, not the utensil drawer.
  [/meat probe|thermometer|baking (tray|sheet|pan)|oven pan|roasting|pizza tray|grill tray/i, "cooking-accessories"],
  // Mepal food storage and table kit — sold through both feeds, filed differently.
  [/mepal|cirqula|omnia|storage bowl|storage jar|storage box|lunch|food storage|salad server|serving set/i, "kitchen-utensils"],
  // Extractor ducting, grease/odour filters, chimney trim, silencers and
  // recirculation kits. Bosch files all of these under "cooking-baking-accessories";
  // Neff correctly calls them hood parts.
  [/odou?r filter|carbon filter|grease filter|filter[- ]grease|acoustic|silencer|exhaust|recirculat|circulating air|flat duct|connector sleeve|lowering frame|\bduct\b|chimney|mounting tower|plinth|diffusor|clean air|extractor|\bhoods?\b/i, "cooker-hood-accessories"],
  // Lamps, bulbs and mechanical spares: Bosch files these as accessories, Neff as
  // spare parts. A replacement lamp is a spare part.
  [/\blamp\b|\bbulb\b|halogen|heater|profile rail|repair kit|\bseal\b|\bhinge\b/i, "spare-parts"],
  [/coffee/i, "coffee-accessories"],
];

/**
 * Runs before anything else, on every source. Consumable chemistry is never an
 * appliance, but Bosch publishes its descaling tablets under
 * /coffee-machines/tassimo-…/ — an appliance URL — so the accessory refinement
 * above would never see them.
 */
export const GLOBAL_PRE = [
  [/descaling tablet|cleaning tablet|descaler\b|descaling (agent|solution|powder)/i, "cleaning-products"],

  // Aug 2026 catalogue drop: records titled "Brand CODE" whose descriptions never
  // name the appliance type. Each pattern is deliberately narrow (guarded with
  // model-family or exact phrasing) so it cannot re-file existing stock.
  [/recirculating kit|carbon filter\b.*\bfor D/i, "cooker-hood-accessories"], // Bosch DWZ* hood kits
  [/\bbox design\b/i, "cooker-hoods"],                        // Bosch DWB* wall hoods
  [/\belica fold\b|\bfold (grey|black|white) \d0\b/i, "cooker-hoods"],
  [/roasterzone|\b\d (?:induction )?zones\b.*power/i, "hobs"],
  [/dishwashw/i, "integrated-dishwashers"],                   // feed's own typo "Dishwashwasher"
  [/side trims? and handle|trim kit\b/i, "cooking-accessories"],
  [/blast chiller/i, "freezers"],
  [/upright cleaner|\bepower\b/i, "vacuum-cleaners"],
  [/pedestal (?:cooling )?fan|\bcooling fan\b.*oscillat/i, "coolers"],
  [/dehumidifier/i, "coolers"],
  [/bluetooth turntable|vinyl turntable/i, "soundbars-speakers"],
  [/outdoor tv\b/i, "televisions"],
  [/waste ?disposal|multigrind/i, "food-prep"],
  // Boiling-water taps and the CUBE sparkling/chilled unit that plumbs into them
  // sit with the taps. The SCR descaler stays under cleaning — it is a consumable.
  [/quooker (pro|flex|fusion|front|classic|combi|cube)|quooker.*(sparkling|chilled)/i, "boiling-water-taps"],
];

/**
 * Narrow corrections where a feed's own URL taxonomy is simply wrong about one of
 * its appliances.
 */
export const APPLIANCE_REFINE = [
  // Neff lists "Built-in microwave oven with hot air" under /ovens/.
  ["ovens", /microwave/i, "microwaves"],
  // Side-by-side / multi-door units filed under plain fridge-freezers.
  ["fridge-freezers", /side[- ]?by[- ]?side|american|multi-?door|french door/i, "american-fridge-freezers"],
  // Bosch publishes Tassimo consumables and water filters under the machine URL.
  ["tassimo", /water filter|cleaning disc|descaling disc|\bfilter\b/i, "coffee-accessories"],
  ["bean-to-cup", /water filter|milk container|cleaning disc|\bfilter\b/i, "coffee-accessories"],
];

/**
 * Some titles arrive with the spaces stripped out entirely
 * ("Series6FreestandingWashingMachine-10Kg", "14cmWarmingDrawer"), which hides
 * every keyword from the rules above. Split camelCase runs and turn punctuation
 * into spaces so "WashingMachine" and "Washing Machine" match identically.
 */
export function normaliseText(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "<cat>/<subcat>" from a bosch/neff product URL. */
export function urlKey(sourceUrl) {
  try {
    const p = new URL(sourceUrl).pathname.split("/").filter(Boolean);
    const i = p.indexOf("product");
    if (i >= 0 && p.length > i + 2) return `${p[i + 1]}/${p[i + 2]}`;
  } catch {}
  return "";
}

/**
 * Resolve one raw record to a leaf id. Throws on anything unclassifiable so a
 * silent mis-file can never reach the site.
 */
export function classify(r) {
  // Match against both the raw text and a de-concatenated copy, so a rule hits
  // whether the source wrote "Washing Machine" or "WashingMachine".
  const text = `${r.description} ${r.name}`;
  const hay = `${text} — ${normaliseText(text)}`;

  for (const [re, leaf] of GLOBAL_PRE) {
    if (re.test(hay)) return { leaf, how: `pre:${re}` };
  }

  const base = baseClassify(r, hay);

  // Same part, two feeds, two URL taxonomies -> converge on the text.
  if (ACCESSORY_LEAVES.has(base.leaf)) {
    for (const [re, leaf] of ACCESSORY_RULES) {
      if (re.test(hay)) return { leaf, how: `${base.how}+refine:${re}` };
    }
    return base;
  }
  for (const [from, re, to] of APPLIANCE_REFINE) {
    if (base.leaf === from && re.test(hay)) return { leaf: to, how: `${base.how}+refine:${re}` };
  }
  return base;
}

function baseClassify(r, hay) {
  if (r.source === "bosch" || r.source === "neff") {
    const key = urlKey(r.source_url);
    if (key.startsWith("spare-parts/")) return { leaf: "spare-parts", how: "url:spare-parts" };
    const leaf = URL_MAP[key];
    if (leaf) return { leaf, how: `url:${key}` };
    throw new Error(`UNMAPPED url key "${key}" for ${r.key} (${r.source_url})`);
  }

  for (const [re, leaf] of TEXT_RULES) {
    if (!re.test(hay)) continue;
    if (leaf === "__DISHWASHER__") {
      const integrated = /integrated|built[- ]?in|built[- ]?under|fully-integrated/i.test(hay);
      return { leaf: integrated ? "integrated-dishwashers" : "freestanding-dishwashers", how: `text:${re}` };
    }
    return { leaf, how: `text:${re}` };
  }
  throw new Error(`UNCLASSIFIED ${r.key}: "${hay.slice(0, 120)}"`);
}
