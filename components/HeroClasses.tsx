import type { CSSProperties } from "react";
import Link from "next/link";

export type ClassTile = {
  id: string;
  name: string;
  count: number;
  image: string;
  from: number | null;
};
export type ClassGroup = { id: string; name: string; tiles: ClassTile[] };

// Art direction, not measurements: recognisable at phone sizes, with varied
// silhouettes forming one continuous skyline rather than identical cards.
const SILHOUETTES: Record<string, [height: number, width: number]> = {
  "washing-machines": [.78, .76], "washer-dryers": [.78, .76], "tumble-dryers": [.78, .76],
  "fridge-freezers": [1, .69], "american-fridge-freezers": [.94, .94],
  fridges: [.94, .66], freezers: [.93, .66], "wine-coolers": [.53, .72],
  "integrated-dishwashers": [.8, .78], "freestanding-dishwashers": [.8, .78],
  ovens: [.59, .83], hobs: [.33, .96], cookers: [.83, .78], microwaves: [.43, .9],
  "cooker-hoods": [.65, .88], "warming-drawers": [.23, .86],
  "kitchen-sinks": [.35, .9], "kitchen-taps": [.72, .65], "boiling-water-taps": [.77, .65],
  televisions: [.72, 1], "soundbars-speakers": [.2, 1], "blu-ray-players": [.25, .94],
  "bean-to-cup": [.65, .76], tassimo: [.56, .65], "filter-coffee": [.66, .6], "coffee-grinders": [.37, .44],
  "vacuum-cleaners": [.49, .84], "cordless-vacuums": [1, .58], "robot-vacuums": [.48, .83], "floor-cleaners": [.95, .6],
  kettles: [.49, .6], toasters: [.4, .76], blenders: [.72, .66], "food-prep": [.62, .84],
  "air-fryers-multi-cookers": [.62, .86], "grills-bbq": [.46, .92], coolers: [.52, .84], cookware: [.29, .87],
};

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
 * Open, connected showroom floors. The complete catalogue navigation is
 * server-rendered; native anchors and CSS interaction need no component JS.
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
      <div className="container-x wide skyline-wrap">
        <header className="skyline-heading">
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

        <nav className="skyline-directory" aria-label="Jump to an appliance department">
          <div className="skyline-desktop-directory">
            <span className="skyline-directory-label">Find your floor <span aria-hidden="true">↘</span></span>
            {directory}
          </div>
          <details className="skyline-mobile-directory">
            <summary>Jump to a department <span aria-hidden="true">↘</span></summary>
            {directory}
          </details>
        </nav>

        <div className="skyline-floors">
          {groups.map((group) => (
            <section key={group.id} id={`skyline-${group.id}`} aria-labelledby={`skyline-title-${group.id}`} className="skyline-floor">
              <header className="skyline-department">
                <span className="skyline-node" aria-hidden="true" />
                <div>
                  <h3 id={`skyline-title-${group.id}`}><Link href={`/categories/${group.id}`} prefetch={false}>{group.name}</Link></h3>
                  <p>{DEPARTMENT_NOTES[group.id] || "Find your everyday favourite."}</p>
                </div>
                <a href="#shop-by-type" className="skyline-back" aria-label="Back to all departments">↑</a>
              </header>

              <ul className="skyline-lineup" data-types={group.tiles.length} style={{
                "--columns": group.tiles.length > 6 ? Math.ceil(group.tiles.length / 2) : group.tiles.length,
                "--max-rise": Math.max(...group.tiles.map((tile) => SILHOUETTES[tile.id]?.[0] ?? .72)),
              } as CSSProperties}>
                {group.tiles.map((tile) => {
                  const [rise, width] = SILHOUETTES[tile.id] || [.72, .78];
                  const frame = Object.entries(PHOTO_FRAMES).find(([path]) => tile.image.split("?")[0].endsWith(path))?.[1];
                  const framing = frame ? {
                    "--photo-ratio": frame[2] / frame[3],
                    "--photo-width": `${frame[4] / frame[2] * 100}%`,
                    "--photo-height": `${frame[5] / frame[3] * 100}%`,
                    "--photo-left": `${-frame[0] / frame[2] * 100}%`,
                    "--photo-top": `${-frame[1] / frame[3] * 100}%`,
                  } as CSSProperties : undefined;
                  return (
                    <li key={tile.id} style={{ "--rise": rise, "--width": width } as CSSProperties}>
                      <Link href={`/categories/${tile.id}`} prefetch={false} className="skyline-type">
                        <span className="skyline-object">
                          <span className="skyline-flag">
                            <span>{tile.name}</span>
                            <span className="skyline-arrow" aria-hidden="true">↗</span>
                          </span>
                          <span className={`skyline-photo${frame ? " skyline-photo-framed" : ""}`} style={framing}>
                            <span className="skyline-cutout">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={tile.image} alt="" loading="lazy" decoding="async" />
                            </span>
                          </span>
                        </span>
                        <span className="skyline-ground" aria-hidden="true"><span /></span>
                        <span className="skyline-ticket">
                          <span className="skyline-models">{tile.count > 0 ? `${tile.count.toLocaleString("en-GB")} ${tile.count === 1 ? "model" : "models"}` : "Enquire in store"}</span>
                          <span className="skyline-price">{tile.from !== null ? <>From <strong>{price(tile.from)}</strong></> : tile.count > 0 ? "Explore the range" : "View this type"}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <footer className="skyline-end">
          <p>Big on appliances. <em>Personal by nature.</em></p>
          <Link href="/categories/accessories-parts">Accessories &amp; spare parts <span aria-hidden="true">↗</span></Link>
        </footer>
      </div>
    </section>
  );
}
