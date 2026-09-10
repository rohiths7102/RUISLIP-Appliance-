// The brand marks the shop holds in public/brands, keyed by the brand name as
// the catalogue writes it. The Brand table carries the same paths; this is the
// copy a card can read, so the mark does not have to be threaded through every
// grid, browser and rail that renders a ProductCard.
//
// Generated from the Brand table (logo set, file present). Twenty-one brands
// have no mark yet — Caple and Indesit are the big ones — and they keep the
// brand name in type, which is why the caller still needs a fallback.
const LOGOS: Record<string, string> = {
  bosch: "/brands/bosch.gif",
  neff: "/brands/neff.gif",
  samsung: "/brands/samsung.gif",
  hotpoint: "/brands/hotpoint.jpg",
  lg: "/brands/lg.gif",
  aeg: "/brands/aeg.png",
  liebherr: "/brands/liebherr.png",
  hoover: "/brands/hoover.gif",
  blomberg: "/brands/blomberg.gif",
  sony: "/brands/sony.jpg",
  beko: "/brands/beko.gif",
  hisense: "/brands/hisense.gif",
  haier: "/brands/haier.gif",
  ninja: "/brands/ninja.jpg",
  shark: "/brands/shark.gif",
  sharp: "/brands/sharp.gif",
  haden: "/brands/haden.jpg",
  siemens: "/brands/siemens.gif",
  miele: "/brands/miele.jpg",
  sensis: "/brands/sensis.png",
  nutribullet: "/brands/nutribullet.png",
  quooker: "/brands/quooker.svg",
};

export const brandLogo = (brand: string): string | null => LOGOS[brand.trim().toLowerCase()] ?? null;
