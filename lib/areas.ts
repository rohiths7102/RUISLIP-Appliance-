/**
 * The owner's delivery reach — ONE list, read by the homepage, the town pages
 * (/areas/[slug]), the site's structured data (areaServed) and llms.txt, so a
 * town added here appears everywhere at once. Grouped by postcode, the way he
 * quotes his area: HA, UB, W3–W6, WD3–WD24 and SL.
 *
 * `districts` are the postcode districts the town mostly sits in (only those
 * inside the delivery zone); `lat`/`lng` are the town centre, approximate, used
 * for "about N miles from the shop" and for nearest-town links.
 */
export type Town = { name: string; slug: string; group: string; districts: string[]; lat: number; lng: number };

// The shop in South Ruislip (same point as the HomeGoodsStore geo in app/layout.tsx).
export const SHOP = { lat: 51.55557, lng: -0.37822 };

const T = (group: string, name: string, districts: string[], lat: number, lng: number): Town =>
  ({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), group, districts, lat, lng });

export const TOWNS: Town[] = [
  T("HA", "Ruislip", ["HA4"], 51.576, -0.4232),
  T("HA", "South Ruislip", ["HA4"], 51.5566, -0.399),
  T("HA", "Ruislip Manor", ["HA4"], 51.5733, -0.413),
  T("HA", "Eastcote", ["HA4", "HA5"], 51.5763, -0.3966),
  T("HA", "Pinner", ["HA5"], 51.5932, -0.3809),
  T("HA", "Northwood", ["HA6"], 51.611, -0.4234),
  T("HA", "Harrow", ["HA1", "HA2", "HA3"], 51.5806, -0.342),
  T("HA", "Rayners Lane", ["HA2", "HA5"], 51.5753, -0.3713),
  T("HA", "Wembley", ["HA0", "HA9"], 51.5588, -0.2817),
  T("HA", "Stanmore", ["HA7"], 51.619, -0.303),
  T("HA", "Edgware", ["HA8"], 51.6136, -0.275),
  T("UB", "Northolt", ["UB5"], 51.548, -0.3683),
  T("UB", "Ickenham", ["UB10"], 51.562, -0.443),
  T("UB", "Uxbridge", ["UB8"], 51.546, -0.478),
  T("UB", "Hillingdon", ["UB10"], 51.533, -0.45),
  T("UB", "Harefield", ["UB9"], 51.603, -0.479),
  T("UB", "Greenford", ["UB6"], 51.5287, -0.3552),
  T("UB", "Southall", ["UB1", "UB2"], 51.511, -0.376),
  T("UB", "Hayes", ["UB3", "UB4"], 51.5125, -0.42),
  T("UB", "West Drayton", ["UB7"], 51.508, -0.472),
  T("W3–W6", "Ealing", ["W5"], 51.513, -0.305),
  T("W3–W6", "Acton", ["W3"], 51.508, -0.273),
  T("W3–W6", "Chiswick", ["W4"], 51.492, -0.258),
  T("W3–W6", "Hammersmith", ["W6"], 51.493, -0.224),
  T("WD3–WD24", "Watford", ["WD17", "WD18", "WD24"], 51.6565, -0.3903),
  T("WD3–WD24", "Rickmansworth", ["WD3"], 51.639, -0.473),
  T("WD3–WD24", "Bushey", ["WD23"], 51.643, -0.36),
  T("WD3–WD24", "Oxhey", ["WD19"], 51.633, -0.39),
  T("WD3–WD24", "Kings Langley", ["WD4"], 51.714, -0.456),
  T("WD3–WD24", "Abbots Langley", ["WD5"], 51.701, -0.416),
  T("WD3–WD24", "Borehamwood", ["WD6"], 51.657, -0.272),
  T("WD3–WD24", "Radlett", ["WD7"], 51.685, -0.317),
  T("SL", "Slough", ["SL1", "SL2", "SL3"], 51.5105, -0.595),
  T("SL", "Langley", ["SL3"], 51.504, -0.547),
  T("SL", "Gerrards Cross", ["SL9"], 51.586, -0.555),
];

export const AREA_GROUPS = ["HA", "UB", "W3–W6", "WD3–WD24", "SL"];

/** Straight-line miles from the shop, rounded — "about N miles". */
export function milesFromShop(t: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(t.lat - SHOP.lat) / 2) ** 2 + Math.cos(rad(SHOP.lat)) * Math.cos(rad(t.lat)) * Math.sin(rad(t.lng - SHOP.lng) / 2) ** 2;
  return Math.max(1, Math.round(3958.8 * 2 * Math.asin(Math.sqrt(a))));
}

export const townBySlug = (slug: string) => TOWNS.find((t) => t.slug === slug);

/** The nearest other towns, for "also delivering to" links. */
export function nearestTowns(t: Town, n = 5): Town[] {
  const d = (o: Town) => (o.lat - t.lat) ** 2 + ((o.lng - t.lng) * Math.cos((t.lat * Math.PI) / 180)) ** 2;
  return TOWNS.filter((o) => o.slug !== t.slug).sort((a, b) => d(a) - d(b)).slice(0, n);
}
