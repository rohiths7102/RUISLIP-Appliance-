import Link from "next/link";
import { Phone, ArrowRight, Wrench, Recycle, Truck, ShoppingBag, ClipboardCheck } from "lucide-react";
import { loadCatalog } from "@/lib/repo";
import { topCategories, childCategories, toCardItem, poaNamesFrom } from "@/lib/select";
import { telHref, waHref } from "@/lib/format";
import Reveal from "@/components/Reveal";
import CountUp from "@/components/CountUp";
import DiscoverPanel from "@/components/DiscoverPanel";
import PromoBanners from "@/components/PromoBanners";
import WhatsAppIcon from "@/components/WhatsAppIcon";
import PostcodeCheck from "@/components/PostcodeCheck";
import HeroShowroom from "@/components/HeroShowroom";
import HeroRooms from "@/components/HeroRooms";
import HeroStage from "@/components/HeroStage";
import HeroClasses from "@/components/HeroClasses";
import BrandWall from "@/components/BrandWall";
import ShowroomFloor from "@/components/ShowroomFloor";
import categoryHeroes from "@/data/category-heroes.json";
import GoogleReviews from "@/components/GoogleReviews";
import ShowroomTour from "@/components/ShowroomTour";
import ProductCard from "@/components/ProductCard";
import { getHomepage, toHomepage, liveOffers, FEATURED_SHOWN } from "@/lib/homepage";
import { getPrisma } from "@/lib/prisma";
import { AREA_GROUPS, TOWNS } from "@/lib/areas";

const STEPS = [
  ["01", "Choose your appliance", "Browse the range and find the model that fits your kitchen."],
  ["02", "Check price & details", "See the price, product code and specs up front."],
  ["03", "Call to confirm stock", "Quote the code and we'll check live availability for you."],
  ["04", "Arrange delivery / fitting", "We book in delivery and installation that suits you."],
];
const STEP_ICONS = [ShoppingBag, ClipboardCheck, Phone, Truck];

// The owner's delivery reach, grouped the way he quotes it: by postcode (lib/areas.ts).
const AREAS = AREA_GROUPS.map((g) => [g, TOWNS.filter((t) => t.group === g)] as const);

// Which hero opens the page: Sachin is comparing three on the preview
// branch — the shop floor of cutouts, the walk through the real shop, and the
// rooms (app/preview/[hero] shows each; the homepage shows the newest).
export type HeroVariant = "floor" | "walk" | "rooms" | "stage" | "classes";

// The stage's cast: the flagship that stands for each department, by code, so
// the title and price under it are the live ones. A department without a
// named flagship puts up its dearest priced model that has a cutout.
const STAGE_CAST: Record<string, { code: string; shot?: string }> = {
  cooking: { code: "B54CR31G0B" }, laundry: { code: "WGG254Z1GB" }, refrigeration: { code: "KGN392LAGG" }, dishwashers: { code: "SMV6ZCX10G" },
  // Quooker's own shot is on white; the cutout was made once from it (public/hero/stage)
  "sinks-taps": { code: "3XBLK", shot: "/hero/stage/quooker-3xblk.png" },
  "coffee-machines": { code: "TAS6502GB" }, "small-appliances": { code: "MUM59340GB" }, "tv-audio": { code: "K85XR55BP.UKA" }, "accessories-parts": { code: "17004034" },
};

// Shop by type: departments in the header's order (accessories have their own
// page and stay out of the grid), and the model whose photo stands for a
// classification where its own picture is a room shot or the wrong product.
const CLASS_ORDER = ["laundry", "refrigeration", "dishwashers", "cooking", "sinks-taps", "tv-audio", "coffee-machines", "floorcare", "small-appliances"];
const CLASS_PICTURE: Record<string, string> = { "vacuum-cleaners": "BGL38BA3GB", "cooker-hoods": "DWK85DK60B", "blu-ray-players": "UBPX700KBCEK" };

export default async function HomePage({ hero }: { hero: HeroVariant }) {
  const { products, categories, brands, business } = await loadCatalog();
  // The owner's choices from Admin → Homepage; defaults (the homepage as it
  // was) when nothing is saved or there is no database.
  const home = await getPrisma().then(getHomepage).catch(() => toHomepage(null));
  const cats = topCategories(categories);

  // One flagship (dearest, photographed) per real appliance department, so the
  // shelf reads as a showroom rather than a bin of filters. Call-for-price
  // categories are excluded — the slideshow leads with the price.
  const poaSet = poaNamesFrom(categories, brands);
  // The featured row is the owner's own promotion, in his order, chosen in
  // Admin → Homepage (it started as the carousel on his Euronics storefront).
  const bestSellers = new Set(home.featured.filter((i) => i.bestSeller).map((i) => i.code));
  const byCode = new Map(products.map((p) => [p.productCode, p]));
  const featured = home.featured
    .map((i) => byCode.get(i.code))
    .filter((p): p is NonNullable<typeof p> => Boolean(p && p.image))
    .slice(0, FEATURED_SHOWN);

  // Best offers — real was/now savings, dearest saving first. The owner asked
  // for value over "premium": lead with what people actually save.
  const offers = products
    .filter((p) => p.image && p.priceNow !== null && p.priceWas !== null && (p.saving ?? 0) > 0 &&
      !poaSet.has(p.category) && !poaSet.has(p.subcategory))
    .sort((a, b) => (b.saving ?? 0) - (a.saving ?? 0))
    .slice(0, 8)
    .map((p) => toCardItem(p, poaSet));

  const brandTape = [...brands].sort((a, b) => b.productCount - a.productCount);

  // Department -> sub-category names for the finder; one vocabulary with the
  // category pages and the /products browser.
  const departments = cats.map((c) => ({
    name: c.name,
    subs: childCategories(categories, c.id).map((s) => s.name),
  }));

  // Brand promotions, the way the shop's own site ran them: one brand, one
  // product type, one click to that shelf. A single portrait cutout cannot fill
  // a wide band -- both reference sites use wide artwork -- so each slide shows a
  // RANGE: the lead product (the one the button sells) front and tallest, two
  // more of the same brand staggered behind it, all on one floor line. Every
  // code is a verified cutout; on a dark ground an opaque shot shows a white box.
  // One slide per brand, carrying that brand's own departments. The owner
  // counted ten pages to flick through to see what one maker offers, so the
  // slide became the brand's front door instead of a single shelf.
  // The slides are the owner's, from Admin → Homepage: one per brand, or the
  // shop's own Euronics slide (brand ""), in his order, switched off as he likes.
  const SLIDES: { codes: string[]; eyebrow: string; line: string; sub: string; cta: string;
                  href?: string; wide?: boolean; logo?: string; chipText?: string; logoLight?: boolean;
                  brand?: string }[] = home.slides.filter((s) => s.enabled).map((s) => s.brand
    ? { codes: s.codes, brand: s.brand, eyebrow: s.brand, line: s.line, sub: s.sub, cta: `Shop all ${s.brand}` }
    : { codes: s.codes, eyebrow: "Euronics Ruislip", logo: "/brand/euronics-logo.png", logoLight: true, chipText: "South Ruislip",
        line: s.line, sub: s.sub, cta: "Browse appliances", href: "/products" });

  // A brand's departments, biggest first. Spare parts are excluded: Bosch has
  // 465 of them and Neff 349, so they would crowd out the appliances a customer
  // came to see.
  const deptLinks = (brand: string) => {
    const tally = new Map<string, number>();
    for (const p of products) {
      if (p.brand !== brand || p.category === "Accessories & Spare Parts") continue;
      tally.set(p.category, (tally.get(p.category) || 0) + 1);
    }
    return [...tally.entries()]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => ({ label: name, href: `/products?brand=${encodeURIComponent(brand)}&cat=${encodeURIComponent(name)}` }));
  };

  const slides = SLIDES.flatMap((sl) => {
    const found = sl.codes.map((c) => products.find((x) => x.productCode === c && x.image)).filter(Boolean);
    const lead = found[0];
    if (!lead) return [];
    const brandSlug = sl.brand ? brands.find((b) => b.name.toLowerCase() === sl.brand!.toLowerCase())?.slug : undefined;
    const href = sl.href ?? (sl.brand ? `/brands/${brandSlug || sl.brand.toLowerCase()}` : `/products?cat=${encodeURIComponent(lead.subcategory)}&brand=${encodeURIComponent(lead.brand)}`);
    // A brand slide shows the brand's own tile; the shop slide (eyebrow is not a
    // brand) keeps its wordmark as text.
    const logo = sl.logo ?? (sl.eyebrow === lead.brand ? (brands.find((b) => b.name === lead.brand)?.logo || "") : "");
    return [{ eyebrow: sl.eyebrow, line: sl.line, sub: sl.sub, cta: sl.cta, href, logo, chipText: sl.chipText, logoLight: sl.logoLight, wide: sl.wide,
              links: sl.brand ? deptLinks(sl.brand) : undefined,
              images: found.map((p) => ({ src: p!.image, alt: p!.title })) }];
  });

  return (
    <div className="home-page">
      {/* ------- HERO — the showroom window, lit like one. Dark ground so the
                 appliance is the only bright thing on the screen; the product
                 bleeds past the grid so it reads as a room, not a thumbnail.
                 No .shot/multiply here — that is for light grounds; this image
                 is a true cutout and needs no blend. ------- */}
      {/* ------- BRAND WALL — every brand, full width, Quooker heading it (components/BrandWall.tsx) ------- */}
      <BrandWall brands={brandTape} />

      <h1 className="sr-only">Euronics Ruislip — kitchen appliances, delivered and fitted in South Ruislip</h1>
      {/* ---------------- THE HERO — three candidates under comparison (Sachin, Oct 2026) ---------------- */}
      {hero === "floor" && (
      <ShowroomFloor total={products.length} bays={cats.map((c) => ({
        id: c.id, name: c.name, count: c.productCount,
        // the cheapest real price in the department, for the plate; none in a call-for-price department
        from: poaSet.has(c.name) ? null : products.reduce<number | null>((m, p) => (p.category === c.name && p.priceNow !== null && !poaSet.has(p.subcategory) && !poaSet.has(p.brand) && (m === null || p.priceNow < m) ? p.priceNow : m), null),
        // every department has a cutout (data/category-heroes.json); a catalogue shot on white would show its box on the dark floor
        shot: (categoryHeroes as Record<string, string>)[c.id] || c.image || products.find((p) => p.category === c.name && p.image)?.image || "",
      }))} />
      )}
      {hero === "walk" && <HeroShowroom total={products.length} departments={cats.map((c) => ({ id: c.id, name: c.name, count: c.productCount }))} />}
      {hero === "classes" && <HeroClasses total={products.length} groups={CLASS_ORDER.flatMap((id) => {
        const c = cats.find((x) => x.id === id); if (!c) return [];
        // Use representative appliance photos (the freezer category's old photo
        // is a fridge freezer). Prices respect every call-for-price flag.
        const pictureCodes: Record<string, string> = { ...CLASS_PICTURE, freezers: "GIN81VEE0G", "washer-dryers": "WNG25401GB" };
        // A temporarily empty range still needs its place in the shop directory.
        const tiles = childCategories(categories, c.id).sort((x, y) => y.productCount - x.productCount).flatMap((s) => {
          const models = products.filter((p) => p.subcategory === s.name && p.category === c.name);
          // Sony's official BDP-S1700/K gallery provides a product cutout; the
          // catalogue's current photo of this model is a cropped room scene.
          const playerPhoto = s.id === "blu-ray-players" && models.some((p) => p.productCode === "BDPS1700K.CEK")
            ? "https://sony.scene7.com/is/image/sonyglobalsolutions/Product-Intro-Plate_M-1?$productIntroPlatemobile$&fmt=png-alpha" : "";
          // The cast belongs to this exact subcategory. Lead with the known
          // representative, then the dearest model from each brand, then fill
          // remaining places by price. Six distinct codes, never repeat stock.
          const photographed = models.map((p) => ({ ...p,
            image: p.productCode === "BDPS1700K.CEK" && playerPhoto ? playerPhoto : p.image,
          })).filter((p) => p.image).sort((x, y) => (y.priceNow ?? 0) - (x.priceNow ?? 0));
          const representative = photographed.find((p) => p.productCode === pictureCodes[s.id]);
          const cast = representative ? [representative] : [];
          for (const p of photographed) {
            if (cast.length < 6 && !cast.some((m) => m.brand === p.brand || m.productCode === p.productCode)) cast.push(p);
          }
          for (const p of photographed) {
            if (cast.length < 6 && !cast.some((m) => m.productCode === p.productCode)) cast.push(p);
          }
          const image = cast[0]?.image || s.image || "";
          const from = poaSet.has(c.name) || poaSet.has(s.name) ? null : models.reduce<number | null>((lowest, p) => {
            if (p.priceNow === null || !Number.isFinite(p.priceNow) || p.priceNow <= 0 || poaSet.has(p.brand)) return lowest;
            return lowest === null || p.priceNow < lowest ? p.priceNow : lowest;
          }, null);
          return [{ id: s.id, name: s.name, count: s.productCount, image, from,
            models: cast.map(({ image, brand, productCode }) => ({ image, brand, productCode })),
          }];
        });
        return tiles.length ? [{ id: c.id, name: c.name, tiles }] : [];
      })} />}
      {hero === "stage" && <HeroStage total={products.length} items={cats.flatMap((c) => {
        const cast = STAGE_CAST[c.id];
        const p = (cast && byCode.get(cast.code)) || products.filter((x) => x.category === c.name && x.image && x.priceNow !== null).sort((x, y) => (y.priceNow ?? 0) - (x.priceNow ?? 0))[0];
        if (!p) return [];
        const shot = cast?.shot || (categoryHeroes as Record<string, string>)[c.id] || p.image;
        const poa = poaSet.has(c.name);
        const from = poa ? null : products.reduce<number | null>((m, x) => (x.category === c.name && x.priceNow !== null && !poaSet.has(x.subcategory) && !poaSet.has(x.brand) && (m === null || x.priceNow < m) ? x.priceNow : m), null);
        return [{ deptId: c.id, dept: c.name, count: c.productCount, from, code: p.productCode, brand: p.brand, title: p.title, price: poa || poaSet.has(p.subcategory) || poaSet.has(p.brand) ? null : p.priceNow, shot }];
      })} />}
      {hero === "rooms" && <HeroRooms total={products.length} departments={cats.map((c) => ({ id: c.id, name: c.name, count: c.productCount }))} />}

      {/* Delivery reach. A second Call button here would repeat the one in the
          sticky header, which is on screen at every scroll position. */}
      <section className="home-postcode home-dark">
        <div className="container-x wide py-6">
          <PostcodeCheck phone={business.phone} />
        </div>
      </section>

      {/* ------- SUPPLIER CAMPAIGNS — the Euronics agent-sales banners the shop
                 already runs on its own storefront, full width under the hero
                 where the guarantee is the first thing after the range. The
                 artwork is Euronics', sized by them; refresh it from
                 kitchen-appliances.co.uk when a campaign ends. ------- */}
      <div className="home-promos">
        {/* Recolour supplied campaign artwork into the same blue/white range.
            Source artwork, labels, links, dates and slideshow controls stay intact. */}
        <svg width="0" height="0" aria-hidden="true" className="absolute">
          <defs><filter id="home-promo-duotone" colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncR type="table" tableValues="0.0392 1" />
              <feFuncG type="table" tableValues="0.1529 1" />
              <feFuncB type="table" tableValues="0.5333 1" />
            </feComponentTransfer>
          </filter></defs>
        </svg>
        <PromoBanners promos={liveOffers(home.offers, new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" })).map((o) => ({ ...o, mobile: o.mobile || o.wide, bg: "#0a2788" }))} />
      </div>

      {/* ------- FINDER — the "help me find it" the owner chose, full width under the hero ------- */}
      <section className="home-finder border-y border-line bg-paper-2">
        <div className="container-x py-6 lg:py-7">
          <DiscoverPanel departments={departments} />
        </div>
      </section>

      {/* ------- SERVICES — installation, fitting, recycling, front and centre
                 (owner: "make the installation fitting recycling more prominent") ------- */}
      <section className="home-services home-dark">
        <div className="container-x grid gap-[18px] py-10 md:grid-cols-3">
          {[
            [Wrench, "Installation & fitting", "Freestanding and built-in appliances installed, tested, and your old one disconnected."],
            [Recycle, "Removal & recycling", "We take the old appliance and every scrap of packaging away with us."],
            [Truck, "Own-van local delivery", "Our own crew delivers around Ruislip — same-day possible, arranged on the phone."],
          ].map(([Icon, title, body], i) => (
            <Reveal key={title as string} delay={i * 70} className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue/10">
                <Icon size={21} className="text-blue-deep" />
              </span>
              <div>
                <h3 className="mb-1 font-display text-[22px] font-medium leading-tight">{title as string}</h3>
                <p className="text-[13.5px] leading-relaxed text-muted">{body as string}</p>
                <Link href="/delivery-services" className="mt-1.5 inline-block text-[12.5px] font-semibold text-blue-deep hover:text-blue">
                  How it works →
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ------- marketing stats band — every number is real, and counts up ------- */}
      <div className="home-stats border-b border-line bg-paper-2">
        <div className="container-x grid grid-cols-2 gap-y-8 py-11 text-center md:grid-cols-4">
          {([
            [<CountUp key="p" to={products.length} />, "appliances in the catalogue"],
            [<CountUp key="b" to={brands.length} />, "trusted appliance brands"],
            ["1977", "serving Ruislip since"],
            ["Own van", "local delivery & fitting"],
          ] as const).map(([big, label], i) => (
            <Reveal key={label} delay={i * 70} className="px-3">
              <div className="font-display text-[clamp(34px,4vw,52px)] font-semibold leading-none text-navy">{big}</div>
              <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-blue-deep">{label}</div>
            </Reveal>
          ))}
        </div>
      </div>

      {/* ------- BEST OFFERS — value first, real was/now savings only ------- */}
      {offers.length >= 4 && (
        <section className="home-offers home-section"><div className="container-x">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.24em] text-blue-deep">— Best offers</p>
              <h2 className="font-display text-[clamp(30px,3.6vw,44px)] font-normal leading-[1.08]">
                Real savings on big brands
              </h2>
            </div>
            <Link href="/products" className="text-sm font-semibold text-blue-deep hover:text-blue">
              Browse everything →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-[14px] md:grid-cols-3 lg:grid-cols-4">
            {offers.map((o, i) => (
              <Reveal key={o.id} delay={i * 60}>
                <ProductCard p={o as never} energyClass={o.energyClass} />
              </Reveal>
            ))}
          </div>
        </div></section>
      )}

      {/* real Google reviews only — renders nothing until genuine data exists */}
      <div className="home-reviews"><GoogleReviews /></div>

      {/* ------- FEATURED — the same row the owner runs on his Euronics
                 storefront: his products, his order, his best-seller flags,
                 and the offer prices synced from that page. ------- */}
      {featured.length > 0 && (
        <section className="home-featured home-section home-dark">
          <div className="container-x">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.24em] text-blue-deep">— This month&rsquo;s offers</p>
                <h2 className="font-display text-[clamp(30px,3.6vw,44px)] font-normal leading-[1.08]">
                  Jyotsna Electrical featured products
                </h2>
              </div>
              <Link href="/products" className="text-sm font-semibold text-blue-deep hover:text-blue">
                Browse everything →
              </Link>
            </div>
            <div className="-mx-6 flex snap-x snap-mandatory gap-[14px] overflow-x-auto px-6 pb-3 [scrollbar-width:thin]">
              {featured.map((p) => {
                const c = toCardItem(p, poaSet);
                return (
                  <div key={c.id} className="relative w-[78vw] shrink-0 snap-start sm:w-[320px] lg:w-[calc((100%-42px)/4)]">
                    {bestSellers.has(p.productCode) && (
                      /* The Euronics best-seller stamp, same as his storefront. */
                      <span className="home-bestseller pointer-events-none absolute right-3 top-3 z-10 flex h-[58px] w-[58px] flex-col items-center justify-center bg-blue text-center font-display text-[12px] font-bold leading-[1.1] text-white">
                        Best<br />seller
                      </span>
                    )}
                    <ProductCard p={c as never} energyClass={c.energyClass} />
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ------- BEST PRICE — the answer to the "Call for best pricing" a
                 customer has just seen on a card. No price-match promise is
                 made here: the shop quotes its own best price on the call. ------- */}
      <section className="home-pricing home-dark">
        <div className="container-x wide grid gap-8 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-14">
          <div>
            <p className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.24em] text-white/60">— Our prices</p>
            <h2 className="font-display text-[clamp(30px,3.4vw,44px)] font-semibold leading-[1.06] text-white">
              Call us for the best price
            </h2>
            <p className="mt-5 max-w-[560px] text-[16.5px] leading-relaxed text-white/80">
              Some models are priced over the phone rather than online. Ring the shop and we
              will quote you our best price on the day, tell you what is actually in stock, and
              price delivery and fitting in the same call.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={telHref(business.phone)}
                className="inline-flex items-center gap-2.5 rounded-sm bg-cta px-7 py-4 text-[15px] font-bold text-white transition-colors hover:bg-cta-deep">
                <Phone size={17} strokeWidth={2.2} /> {business.phone}
              </a>
              <a href={waHref()} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 rounded-sm bg-[#25D366] px-7 py-4 text-[15px] font-bold text-white transition-colors hover:bg-[#1da851]">
                <WhatsAppIcon size={18} /> Ask on WhatsApp
              </a>
            </div>
          </div>
          <ul className="grid gap-4">
            {/* Euronics' own price-check promise, worded as it is on the card in
                the shop. It is the group's claim, not one we invented, so it is
                set with their mark. */}
            {[
              ["Our best price, quoted on the call", "The price you see is never the end of it. Tell us the model and we will do our sharpest number for you."],
              ["Stock confirmed while you are on the phone", "We check the shop and the supplier there and then, so you know what you are getting and when."],
              ["Delivery and fitting priced together", "Our own vans and our own fitters, quoted with the appliance — no surprises at the door."],
            ].map(([title, body]) => (
              <li key={title} className="border border-white/15 bg-white/[0.06] p-6">
                <p className="font-display text-[19px] font-semibold leading-snug text-white">{title}</p>
                <p className="mt-2 text-[14.5px] leading-relaxed text-white/70">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------- HERITAGE — the family story, like the reference site ---------------- */}
      <section className="home-heritage home-dark bg-blue px-6 py-14">
        <div className="mx-auto max-w-[1000px] text-center">
          <p className="mb-8 font-mono text-[11px] uppercase tracking-[0.24em] text-sky">
            — Family run since 1977
          </p>
          <p className="font-display text-[clamp(26px,3.8vw,48px)] leading-[1.24] text-white">
            Jyotsna Electrical has sold appliances in South Ruislip since 1977 — a family-run
            member of Euronics, with our own vans and people you can actually call.
          </p>
          <p className="mx-auto mt-7 max-w-[640px] text-[15.5px] leading-relaxed text-white/75">
            Real advice, fair prices, and proper aftercare long after the box has gone.
            That is the whole business model, and it has not changed in nearly fifty years.
          </p>
        </div>
      </section>

      {/* ---------------- HOW IT WORKS ---------------- */}
      <section className="home-steps home-section"><div className="container-x">
        <Reveal className="mb-8">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.24em] text-blue-deep">— Simple &amp; clear</p>
          <h2 className="font-display text-[44px] font-normal">How it works</h2>
        </Reveal>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([num, title, body], i) => {
            const Icon = STEP_ICONS[i];
            return (
              <Reveal key={num} delay={i * 70} className="home-step">
                <span className="sr-only">{num}</span>
                <Icon className="home-step-icon" size={26} aria-hidden="true" />
                <h3 className="mb-2.5 font-display text-2xl font-medium">{title}</h3>
                <p className="text-sm leading-relaxed text-muted">{body}</p>
              </Reveal>
            );
          })}
        </div>
      </div></section>

      {/* ---------------- BRAND TAPE — real logos, running like a showroom window ---------------- */}
      <section className="home-brands home-section border-y border-line bg-paper-2">
        <div className="container-x">
          <Reveal className="mb-9 text-center">
            <p className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.24em] text-blue-deep">— The brands we stock</p>
            <h2 className="font-display text-[40px] font-normal">{brands.length} trusted appliance brands</h2>
          </Reveal>
        </div>
        {/* A running tape of the brands, the way a showroom window rotates them.
            The track is the list twice over, so translating it half its width
            loops seamlessly; hovering stops it, and it holds still for anyone
            who asks for reduced motion (see .marquee in globals.css). */}
        <div className="group/tape relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)]">
          <div className="marquee flex w-max gap-3 group-hover/tape:[animation-play-state:paused]">
            {[...brandTape, ...brandTape].map((b, i) => (
              <Link key={`${b.id}-${i}`} href={`/brands/${b.slug}`} title={`${b.name} — ${b.productCount} models`}
                aria-hidden={i >= brandTape.length} tabIndex={i >= brandTape.length ? -1 : undefined}
                className="flex h-[76px] w-[150px] shrink-0 items-center justify-center rounded-lg border border-line bg-white px-5 transition-colors hover:border-blue">
                {b.logo ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={b.logo} alt={`${b.name} logo`} loading="lazy" className="max-h-[38px] max-w-[86%] object-contain" />
                ) : (
                  <span className="text-center text-[13px] font-bold uppercase leading-tight tracking-[0.08em] text-blue-deep">{b.name}</span>
                )}
              </Link>
            ))}
          </div>
        </div>
        <div className="container-x">
          <div className="mt-8 text-center">
            <Link href="/brands" className="inline-flex items-center gap-2 border-b border-blue pb-1 text-[13px] font-semibold text-blue-deep hover:text-blue">
              See all brands <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------- LOCAL SERVICE ---------------- */}
      <section className="home-areas home-section"><div className="container-x">
        <div className="grid items-start gap-8 lg:grid-cols-[1.3fr_0.7fr]">
          <div>
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.24em] text-blue-deep">— Serving the local area</p>
            <h2 className="mb-5 font-display text-[44px] font-normal leading-[1.08]">
              Proudly serving Ruislip &amp; South Ruislip
            </h2>
            <p className="mb-7 text-base leading-relaxed text-muted">
              Our own local delivery and fitting covers the <strong className="font-semibold text-ink">HA</strong>,{" "}
              <strong className="font-semibold text-ink">UB</strong>, <strong className="font-semibold text-ink">W3&ndash;W6</strong>,{" "}
              <strong className="font-semibold text-ink">WD3&ndash;WD24</strong> and <strong className="font-semibold text-ink">SL</strong>{" "}
              postcodes — from Ruislip out to Harrow, Watford, Ealing and Slough. Because we deliver ourselves, we can
              talk you through dates, access and installation before anything leaves the shop.
            </p>
            <div className="divide-y divide-ink/10 border-y border-ink/10">
              {AREAS.map(([code, towns], i) => (
                <Reveal key={code} delay={i * 70} className="grid grid-cols-[92px_1fr] items-start gap-4 py-3.5">
                  <span className="pt-1.5 font-mono text-[12px] font-semibold tracking-[0.08em] text-blue-deep">{code}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {towns.map((t) => (
                      <Link key={t.slug} href={`/areas/${t.slug}`} className="rounded-full border border-ink/15 bg-white px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:border-blue hover:text-blue-deep">{t.name}</Link>
                    ))}
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
          <div className="home-coverage home-dark border border-blue bg-blue p-6 lg:sticky lg:top-56 lg:p-8">
            <h3 className="mb-3 font-display text-[28px]">Are we in your area?</h3>
            <p className="mb-6 text-[14.5px] leading-relaxed text-muted">
              We deliver to the HA, UB, W3&ndash;W6, WD3&ndash;WD24 and SL postcodes from {business.address.postcode}.
              Rather than overpromise, we&apos;d sooner you call — we&apos;ll tell you honestly whether we cover
              you, what it costs and when we can come.
            </p>
            <a href={telHref(business.phone)}
              className="inline-flex items-center gap-2 bg-cta px-6 py-4 text-[15px] font-bold text-white transition-colors hover:bg-cta-deep">
              <Phone size={17} /> Call to check coverage
            </a>
          </div>
        </div>
      </div></section>

      {/* ------- SHOWROOM TOUR — the real shop, walkable (proof, not claims) ------- */}
      <section id="showroom-tour" className="home-tour home-section home-dark scroll-mt-56"><div className="container-x">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.24em] text-blue-deep">— The real shop</p>
        <h2 className="mb-5 font-display text-[44px] font-normal leading-[1.08]">
          Walk around our showroom, from your sofa
        </h2>
        <div className="home-tour-stage">
          {/* Existing photograph of the real shop; the heavy tour still loads on tap. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hero/showroom-walk.jpg" alt="" loading="lazy" decoding="async" width={1280} height={720} className="home-tour-photo" />
          <ShowroomTour className="home-tour-viewer" />
        </div>
      </div></section>

      {/* ---------------- CONTACT CTA ---------------- */}
      <section className="home-contact home-dark bg-blue">
        <div className="container-x mx-auto max-w-[900px] py-14 text-center">
          <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.24em] text-sky">
            — Found something you like?
          </p>
          <h2 className="mb-6 font-display text-[clamp(34px,4.5vw,54px)] leading-[1.06] text-paper">
            Call to confirm availability
            <br />
            before you visit.
          </h2>
          <p className="mx-auto mb-9 max-w-[560px] text-[17px] leading-relaxed text-[#b9c4ea]">
            Quote the product code and we&apos;ll check live stock, give you the best price and book in
            delivery or installation — all in one call.
          </p>
          <a href={telHref(business.phone)}
            className="group inline-flex items-center gap-3 bg-cta px-10 py-5 text-[17px] font-bold text-white transition-colors hover:bg-cta-deep">
            <Phone size={19} /> {business.phone}
            <ArrowRight size={18} className="transition-transform duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] group-hover:translate-x-[3px]" />
          </a>
        </div>
      </section>
    </div>
  );
}
