import Link from "next/link";
import BestSellerSpotlight, { type Spotlight } from "@/components/BestSellerSpotlight";

/**
 * The classifications at the top of the homepage, in the Ruislip Appliances
 * format Sachin asked for (17 Oct 2026): one plain tile per kind of appliance,
 * its name on a navy bar over a clean product photo, five to a row, one tap to
 * the shelf. Nothing else — he found the longer versions confusing.
 *
 * On wide screens, 1536px and up (Oct 2026), the empty margins either side carry two rails:
 * this month's offers (the banners Sachin manages in Admin → Homepage) and a
 * rotating best seller. On laptops and phones the tiles stand alone, as before.
 */
export type TypeTile = { name: string; href: string; image: string };
export type RailOffer = { id: string; href: string; alt: string; image: string };

export default function ShopByType({ tiles, offers = [], picks = [] }: { tiles: TypeTile[]; offers?: RailOffer[]; picks?: Spotlight[] }) {
  const rails = offers.length > 0 || picks.length > 0;
  return (
    <section aria-labelledby="shop-by-type" className="bg-white">
      <div className={`mx-auto px-4 py-8 sm:py-10 ${rails ? "max-w-[1100px] 2xl:grid 2xl:max-w-[1560px] 2xl:grid-cols-[240px_minmax(0,1fr)_240px] 2xl:items-start 2xl:gap-8" : "max-w-[1100px]"}`}>
        {rails && (
          <aside aria-label="This month's offers" className="hidden 2xl:sticky 2xl:top-[150px] 2xl:block">
            <p className="bg-[#1b3e7b] px-3 py-2 text-center text-[15px] font-light text-white">This month&apos;s offers</p>
            <ul className="space-y-3 border border-t-0 border-line p-3">
              {offers.map((o, n) => (
                <li key={o.id}>
                  <Link href={o.href} className="offer-rail group block overflow-hidden" style={{ animationDelay: `${n * 160}ms` }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={o.image} alt={o.alt} loading="lazy" className="block w-full transition-transform duration-700 group-hover:scale-[1.05]" />
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
        <div>
          <h2 id="shop-by-type" className="sr-only">Shop by type</h2>
          <ul className="grid grid-cols-2 gap-x-3 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 lg:grid-cols-5">
            {tiles.map((t) => (
              <li key={t.href} className="row-span-2 grid grid-rows-subgrid">
                <Link href={t.href} className="group row-span-2 grid grid-rows-subgrid bg-white transition-shadow duration-200 hover:shadow-[0_6px_18px_rgba(8,21,56,.14)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b3e7b]">
                  <span className="flex items-center justify-center bg-[#1b3e7b] px-2 py-1 text-center text-[15px] font-light leading-snug text-white sm:text-[16px]">{t.name}</span>
                  <span className="mb-3 block aspect-square p-3 sm:mb-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.image} alt="" aria-hidden loading="lazy" className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.04]" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        {rails && (
          <aside aria-label="Best seller" className="hidden 2xl:sticky 2xl:top-[150px] 2xl:block">
            <BestSellerSpotlight picks={picks} />
          </aside>
        )}
      </div>
    </section>
  );
}
