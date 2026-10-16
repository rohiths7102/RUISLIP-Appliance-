import type { CSSProperties } from "react";
import Link from "next/link";

export type ClassTile = {
  id: string;
  name: string;
  count: number;
  image: string;
  models: { image: string; brand: string; productCode: string }[];
  from: number | null;
};
export type ClassGroup = { id: string; name: string; tiles: ClassTile[] };

// Measured whitespace in these exact supplier photos: x, y, visible width and
// height, original width and height (in proportional units). CSS crops only
// the empty margin; an owner-selected replacement gets normal contain sizing.
const PHOTO_FRAMES: Record<string, [number, number, number, number, number, number]> = {
  "/catalog/ruislip/DV90F09F4SU1/01.jpg": [51, 14, 198, 272, 300, 300],
  "/catalog/ruislip/DB273TX/01.jpg": [45, 11, 210, 280, 300, 300],
  "/catalog/ruislip/HDG6GDCWX/01.jpg": [51, 0, 198, 300, 300, 300],
  "/catalog/ruislip/CR329X/01.jpg": [0, 42, 300, 258, 300, 300],
  "/catalog/caple/AXL50/01.jpg": [33, 50, 239, 196, 300, 300],
  "/catalog/caple/ANT4/BN/01.jpg": [27, 56, 187, 191, 249, 300],
  "/catalog/quooker/3XRVS/01.jpg": [43, 10, 216, 280, 300, 300],
  "/catalog/ruislip/K98XR55BP.UKA/01.jpg": [49, 20, 207, 161, 300, 200],
  "/catalog/ruislip/HTA9000.CEK/01.jpg": [15, 80, 270, 29, 300, 188],
  "/catalog/bosch/TAS6502GB/01.webp": [0, 0, 234, 290, 260, 300],
  "/catalog/bosch/TKA2M113GB/01.webp": [0, 0, 199, 268, 199, 300],
  "/catalog/ruislip/WD210UK/01.jpg": [79, 0, 142, 300, 300, 300],
  "/catalog/bosch/MUMS6ZM00G/01.webp": [0, 0, 300, 132, 300, 151],
  "/catalog/bosch/17007157/01.webp": [5, 45, 242, 113, 300, 158],
  "/catalog/ruislip/ST202UK/01.jpg": [15, 76, 267, 148, 300, 300],
  "/catalog/bosch/TWK7201GB/01.webp": [0, 0, 183, 246, 183, 300],
  "/catalog/ruislip/SFP700UK/01.jpg": [27, 38, 251, 219, 300, 272],
  "/catalog/ruislip/FS301UK/01.jpg": [67, 29, 134, 248, 300, 300],
  "/catalog/ruislip/FB265EUUKGY/01.jpg": [12, 89, 267, 171, 300, 300],
  "/catalog/ruislip/PG301UK/01.jpg": [50, 73, 195, 159, 300, 300],
  "/is/image/sonyglobalsolutions/Product-Intro-Plate_M-1": [65, 365, 1405, 347, 1534, 1083],
};

const DEPARTMENT_NOTES: Record<string, string> = {
  laundry: "A fresh start, every day.",
  refrigeration: "Room for the good stuff.",
  dishwashers: "Let dinner be the hard part.",
  cooking: "For whatever’s cooking.",
  "sinks-taps": "The heart of your kitchen.",
  "tv-audio": "Make a night of it.",
  "coffee-machines": "Your morning, made.",
  floorcare: "Life happens. Clean up.",
  "small-appliances": "Little things. Big difference.",
};

const price = (amount: number) => new Intl.NumberFormat("en-GB", {
  style: "currency", currency: "GBP", maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
}).format(amount);

/**
 * Stocked showroom floors, with up to six distinct real models per type.
 * Every type is server-rendered; native anchors need no component JavaScript.
 */
export default function HeroClasses({ groups, total }: { groups: ClassGroup[]; total: number }) {
  const typeCount = groups.reduce((n, group) => n + group.tiles.length, 0);
  const directory = <ul>{groups.map((group) => (
    <li key={group.id}>
      <a href={`#skyline-${group.id}`}>
        {group.name}<span className="skyline-directory-count">{group.tiles.length}<span className="sr-only"> types</span></span>
      </a>
    </li>
  ))}</ul>;

  return (
    <section id="shop-by-type" aria-labelledby="hero-heading" className="skyline">
      <div className="skyline-masthead">
        <header className="container-x wide skyline-heading">
          <div>
            <p className="skyline-intro">Your local appliance shop, since 1977</p>
            <h2 id="hero-heading">Shop by type<span className="skyline-full-stop">.</span></h2>
            <p className="skyline-invitation">A whole home. <em>All here.</em></p>
          </div>
          <div className="skyline-welcome">
            <span className="skyline-stamp"><strong>{typeCount}</strong><span>types to explore</span></span>
            <p>{total.toLocaleString("en-GB")}+ appliances.<br />Delivered &amp; fitted by our own team.</p>
          </div>
        </header>

      </div>
        <nav className="skyline-directory" aria-label="Jump to an appliance department">
          <div className="container-x wide skyline-directory-inner">
          <div className="skyline-desktop-directory">
            <span className="skyline-directory-label">Find your floor <span aria-hidden="true">↘</span></span>
            {directory}
          </div>
          <details className="skyline-mobile-directory">
            <summary>Jump to a department <span aria-hidden="true">↘</span></summary>
            {directory}
          </details>
          </div>
        </nav>

        <div className="skyline-floors">
          {groups.map((group) => (
            <section key={group.id} id={`skyline-${group.id}`} aria-labelledby={`skyline-title-${group.id}`} className="skyline-floor">
              <div className="container-x wide">
              <header className="skyline-department">
                <div>
                  <h3 id={`skyline-title-${group.id}`}><Link href={`/categories/${group.id}`} prefetch={false}>{group.name}</Link></h3>
                  <p>{DEPARTMENT_NOTES[group.id] || "Find your everyday favourite."}</p>
                </div>
                <a href="#shop-by-type" className="skyline-back" aria-label="Back to all departments">↑</a>
              </header>

              <ul className="skyline-lineup" data-types={group.tiles.length}>
                {group.tiles.map((tile) => {
                  // An empty range keeps its real category photograph and link;
                  // never duplicate an appliance to make a sparse range look full.
                  const photos = tile.models.length ? tile.models : tile.image
                    ? [{ image: tile.image, brand: "", productCode: "" }] : [];
                  return (
                    <li key={tile.id}>
                      <Link href={`/categories/${tile.id}`} prefetch={false} className="skyline-type">
                          <span className="skyline-flag">
                            <span>{tile.name}</span>
                            <span className="skyline-arrow" aria-hidden="true">↗</span>
                          </span>
                          <span className="skyline-stock" aria-hidden="true" data-models={photos.length} style={{ "--stock-columns": Math.min(photos.length, 3) || 1 } as CSSProperties}>
                            {photos.map((model) => {
                              const frame = Object.entries(PHOTO_FRAMES).find(([path]) => model.image.split("?")[0].endsWith(path))?.[1];
                              const framing = frame ? {
                                "--photo-ratio": frame[2] / frame[3],
                                "--photo-width": `${frame[4] / frame[2] * 100}%`,
                                "--photo-height": `${frame[5] / frame[3] * 100}%`,
                                "--photo-left": `${-frame[0] / frame[2] * 100}%`,
                                "--photo-top": `${-frame[1] / frame[3] * 100}%`,
                              } as CSSProperties : undefined;
                              return (
                                <span key={model.productCode || model.image} className="skyline-model" title={`${model.brand} ${model.productCode}`.trim()}>
                                  <span className={`skyline-photo${frame ? " skyline-photo-framed" : ""}`} style={framing}>
                                    <span className="skyline-cutout">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={model.image} alt="" loading="lazy" decoding="async" width={160} height={160} />
                                    </span>
                                  </span>
                                  {model.productCode && <span className="skyline-model-caption"><b>{model.brand}</b><span>{model.productCode}</span></span>}
                                </span>
                              );
                            })}
                          </span>
                        <span className="skyline-ground" aria-hidden="true"><span /></span>
                        <span className="skyline-ticket">
                          <span className="skyline-models">{tile.count > 0 ? <><strong>{tile.count.toLocaleString("en-GB")}</strong> {tile.count === 1 ? "model" : "models"}</> : "Enquire in store"}</span>
                          <span className="skyline-price">{tile.from !== null ? <>From <strong>{price(tile.from)}</strong></> : tile.count > 0 ? "Explore the range" : "View this type"}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              </div>
            </section>
          ))}
        </div>

        <footer className="skyline-end"><div className="container-x wide">
          <p>Big on appliances. <em>Personal by nature.</em></p>
          <Link href="/categories/accessories-parts">Accessories &amp; spare parts <span aria-hidden="true">↗</span></Link>
        </div></footer>
    </section>
  );
}
