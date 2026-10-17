import Link from "next/link";

/**
 * The classifications at the top of the homepage, in the Ruislip Appliances
 * format Sachin asked for (17 Oct 2026): one plain tile per kind of appliance,
 * its name on a navy bar over a clean product photo, five to a row, one tap to
 * the shelf. Nothing else — he found the longer versions confusing.
 */
export type TypeTile = { name: string; href: string; image: string };

export default function ShopByType({ tiles }: { tiles: TypeTile[] }) {
  return (
    <section aria-labelledby="shop-by-type" className="bg-white">
      <div className="mx-auto max-w-[1100px] px-4 py-8 sm:py-10">
        <h2 id="shop-by-type" className="sr-only">Shop by type</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
          {tiles.map((t) => (
            <li key={t.href}>
              <Link href={t.href} className="group block bg-white transition-shadow duration-200 hover:shadow-[0_6px_18px_rgba(8,21,56,.14)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b3e7b]">
                <span className="block bg-[#1b3e7b] px-2 py-1 text-center text-[15px] font-light leading-snug text-white sm:text-[16px]">{t.name}</span>
                <span className="block aspect-square p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.image} alt="" aria-hidden loading="lazy" className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.04]" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
