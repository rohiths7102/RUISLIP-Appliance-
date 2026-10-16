import Link from "next/link";

/**
 * The homepage opens on the classifications (Sachin, 16 Oct 2026, after the
 * Ruislip Appliances home page): every kind of appliance we stock, each a
 * tile with its name on a navy bar and a clean product photo under it, one
 * tap to that shelf. Grouped by department so the eye can find laundry, then
 * cooking, and so on. Only classifications with products in them are shown.
 */
export type ClassTile = { id: string; name: string; count: number; image: string };
export type ClassGroup = { id: string; name: string; tiles: ClassTile[] };

export default function HeroClasses({ groups, total }: { groups: ClassGroup[]; total: number }) {
  return (
    <section aria-labelledby="hero-heading" className="bg-paper">
      <div className="container-x wide pb-12 pt-8 lg:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
          <h2 id="hero-heading" className="font-display text-[clamp(28px,3vw,40px)] leading-tight text-navy">Shop by type</h2>
          <p className="text-[14px] text-muted">{total.toLocaleString("en-GB")}+ appliances · delivered and fitted by our own team</p>
        </div>

        <div className="mt-6 space-y-8">
          {groups.map((g) => (
            <div key={g.id}>
              <h3 className="mb-3 flex items-baseline gap-3 text-[15px] font-semibold text-navy">
                <Link href={`/categories/${g.id}`} className="hover:underline">{g.name}</Link>
              </h3>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {g.tiles.map((t) => (
                  <li key={t.id}>
                    <Link href={`/categories/${t.id}`}
                      className="group block overflow-hidden rounded-[4px] border border-line bg-white transition-shadow duration-300 hover:shadow-[0_10px_30px_rgba(8,21,56,.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue">
                      <span className="block bg-blue-deep px-3 py-2 text-center text-[14px] font-medium leading-tight text-white transition-colors group-hover:bg-blue">{t.name}</span>
                      <span className="block aspect-square p-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={t.image} alt="" aria-hidden loading="lazy"
                          className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105" />
                      </span>
                      <span className="block pb-3 text-center text-[12px] text-muted">{t.count.toLocaleString("en-GB")} models</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
