import Link from "next/link";
import { Phone, ArrowRight, Wrench, Recycle, Truck } from "lucide-react";
import { loadCatalog } from "@/lib/repo";
import { topCategories, childCategories, toCardItem, poaNamesFrom } from "@/lib/select";
import { telHref, waHref } from "@/lib/format";
import Reveal from "@/components/Reveal";
import CountUp from "@/components/CountUp";
import DiscoverPanel from "@/components/DiscoverPanel";
import PromoBanners from "@/components/PromoBanners";
import WhatsAppIcon from "@/components/WhatsAppIcon";
import HeroSlides from "@/components/HeroSlides";
import PostcodeCheck from "@/components/PostcodeCheck";
import GoogleReviews from "@/components/GoogleReviews";
import ShowroomTour from "@/components/ShowroomTour";
import ProductCard from "@/components/ProductCard";
import featuredSync from "@/data/featured-products.json";
import categoryHeroes from "@/data/category-heroes.json";
export const revalidate = 300;

/** The current Euronics agent-sales campaigns, as run on the shop's own
 *  storefront. Liebherr ends 31.10.26; swap the artwork and the link when
 *  Euronics issues the next one. */
const PROMOS = [
  { href: "/brands/liebherr", alt: "Liebherr — 10-year guarantee on all household appliances",
    wide: "/promo/liebherr-wide.png", mobile: "/promo/liebherr-mobile.png" },
  { href: "/brands/schonhaus", alt: "Schonhaus — beautifully at home, 5-year guarantee",
    wide: "/promo/schonhaus-wide.png", mobile: "/promo/schonhaus-mobile.png" },
];

const STEPS = [
  ["01", "Choose your appliance", "Browse the range and find the model that fits your kitchen."],
  ["02", "Check price & details", "See the price, product code and specs up front."],
  ["03", "Call to confirm stock", "Quote the code and we'll check live availability for you."],
  ["04", "Arrange delivery / fitting", "We book in delivery and installation that suits you."],
];

const AREAS = ["Ruislip", "South Ruislip", "Eastcote", "Northolt", "Pinner", "Ickenham", "Ruislip Manor"];

export default async function Home() {
  const { products, categories, brands, business } = await loadCatalog();
  const cats = topCategories(categories);

  // One flagship (dearest, photographed) per real appliance department, so the
  // shelf reads as a showroom rather than a bin of filters. Call-for-price
  // categories are excluded — the slideshow leads with the price.
  const poaSet = poaNamesFrom(categories);
  // The featured row is the owner's own promotion, not ours: it mirrors the
  // "featured products" carousel on his Euronics storefront, in his order, with
  // the Euronics best-seller flags. scripts/catalog/sync-featured.mjs refreshes
  // data/featured-products.json (and the prices) from that page.
  const bestSellers = new Set(featuredSync.items.filter((i) => i.bestSeller).map((i) => i.code));
  const byCode = new Map(products.map((p) => [p.productCode, p]));
  const featured = featuredSync.items
    .map((i) => byCode.get(i.code))
    .filter((p): p is NonNullable<typeof p> => Boolean(p && p.image))
    .slice(0, 12);

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
  const SLIDES: { codes: string[]; eyebrow: string; line: string; sub: string; cta: string;
                  href?: string; wide?: boolean; logo?: string; chipText?: string; logoLight?: boolean }[] = [
    { codes: ["RF605QNUVX1", "SMS6ZCI10G", "WRB247C9GB"], eyebrow: "Euronics Ruislip",
      logo: "/brand/euronics-logo.png", logoLight: true, chipText: "Ruislip", line: "Proper appliances, properly fitted.",
      sub: "Bosch, Neff, Miele and the brands you trust — at Euronics prices, delivered and fitted by our own team.",
      cta: "Browse appliances", href: "/products" },
    { codes: ["KFD96APEA", "KFI96APEAG", "KIN96NSE0G"], eyebrow: "Bosch", line: "American fridge freezers",
      sub: "Series 6 and Series 8, delivered in our own van and fitted by our own team.", cta: "Shop Bosch fridge freezers" },
    { codes: ["C24MT73G0B", "U2ACH7AG7B", "U2ACH7AN7B"], eyebrow: "Neff", line: "Built-in ovens",
      sub: "Slide&Hide and CircoTherm, built for the kitchen you\u2019ve planned. Installed and tested by us.", cta: "Shop Neff ovens" },
    { codes: ["WEE385WCS", "WEG885 WCS", "WED385WCS"], eyebrow: "Miele", line: "Washing machines",
      sub: "Made to last twenty years. Delivered, fitted, and the old one taken away.", cta: "Shop Miele washing machines" },
    { codes: ["WF90F09C4SU1", "WW11DB8B95GHU1", "WW11DB8B95GBU1"], eyebrow: "Samsung", line: "Washing machines",
      sub: "AI Wash and 11kg drums, delivered in our own van and fitted by our own team.", cta: "Shop Samsung washing machines" },
  ];
  // Every code above is a verified cutout (transparent background). Catalogue
  // shots on a white plate look like a floating white box on this blue, so the
  // dearest model is not always the one that can go in the hero.
  const slides = SLIDES.flatMap((sl) => {
    const found = sl.codes.map((c) => products.find((x) => x.productCode === c && x.image)).filter(Boolean);
    const lead = found[0];
    if (!lead) return [];
    const href = sl.href ?? `/products?cat=${encodeURIComponent(lead.subcategory)}&brand=${encodeURIComponent(lead.brand)}`;
    // A brand slide shows the brand's own tile; the shop slide (eyebrow is not a
    // brand) keeps its wordmark as text.
    const logo = sl.logo ?? (sl.eyebrow === lead.brand ? (brands.find((b) => b.name === lead.brand)?.logo || "") : "");
    return [{ eyebrow: sl.eyebrow, line: sl.line, sub: sl.sub, cta: sl.cta, href, logo, chipText: sl.chipText, logoLight: sl.logoLight, wide: sl.wide,
              images: found.map((p) => ({ src: p!.image, alt: p!.title })) }];
  });

  return (
    <>
      {/* ------- HERO — the showroom window, lit like one. Dark ground so the
                 appliance is the only bright thing on the screen; the product
                 bleeds past the grid so it reads as a room, not a thumbnail.
                 No .shot/multiply here — that is for light grounds; this image
                 is a true cutout and needs no blend. ------- */}
      <section className="relative overflow-hidden bg-[#1b3d7d]">
        <h1 className="sr-only">Euronics Ruislip — kitchen appliances, delivered and fitted in South Ruislip</h1>
        <HeroSlides slides={slides} />
        {/* Delivery reach only. A second Call button here would repeat the one in
            the sticky header, which is on screen at every scroll position. */}
        <div className="container-x wide border-t border-white/15 py-6">
          <PostcodeCheck phone={business.phone} />
        </div>
      </section>

      {/* ------- SUPPLIER CAMPAIGNS — the Euronics agent-sales banners the shop
                 already runs on its own storefront, full width under the hero
                 where the guarantee is the first thing after the range. The
                 artwork is Euronics', sized by them; refresh it from
                 kitchen-appliances.co.uk when a campaign ends. ------- */}
      <PromoBanners promos={PROMOS} />

      {/* ------- FINDER — the "help me find it" the owner chose, full width under the hero ------- */}
      <section className="border-y border-line bg-card">
        <div className="container-x py-6 lg:py-7">
          <DiscoverPanel departments={departments} />
        </div>
      </section>

      {/* ------- SERVICES — installation, fitting, recycling, front and centre
                 (owner: "make the installation fitting recycling more prominent") ------- */}
      <section className="border-y border-line bg-card">
        <div className="container-x grid gap-[18px] py-14 md:grid-cols-3">
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
      <div className="border-b border-line bg-white">
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
        <section className="container-x py-20">
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
        </section>
      )}

      {/* real Google reviews only — renders nothing until genuine data exists */}
      <GoogleReviews />

      {/* ------- FEATURED — the same row the owner runs on his Euronics
                 storefront: his products, his order, his best-seller flags,
                 and the offer prices synced from that page. ------- */}
      {featured.length > 0 && (
        <section className="bg-card py-20">
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
                      <span className="pointer-events-none absolute right-3 top-3 z-10 flex h-[58px] w-[58px] flex-col items-center justify-center rounded-full bg-blue text-center font-display text-[9px] font-bold uppercase leading-[1.1] tracking-[0.06em] text-white shadow-[0_6px_16px_rgba(10,39,136,.35)]">
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
      <section className="bg-[#1b3d7d]">
        <div className="container-x wide grid gap-10 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-20">
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
              <a href={waHref(business.phone)} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 rounded-sm bg-[#25D366] px-7 py-4 text-[15px] font-bold text-white transition-colors hover:bg-[#1da851]">
                <WhatsAppIcon size={18} /> Ask on WhatsApp
              </a>
            </div>
          </div>
          <ul className="grid gap-4">
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

      {/* ---------------- CATEGORIES ---------------- */}
      <section className="container-x pb-10 pt-24">
        <Reveal className="mb-11 flex items-end justify-between gap-4">
          <div>
            <p className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.24em] text-blue-deep">— Departments</p>
            <h2 className="font-display text-[44px] font-normal leading-[1.05]">Browse by category</h2>
          </div>
          <Link href="/products" className="hidden shrink-0 border-b border-blue pb-1 text-[13px] font-semibold hover:text-blue-deep sm:block">
            View all appliances →
          </Link>
        </Reveal>
        {/* Big panels on the shop's own blue with a diagonal wedge, the way his
            Euronics storefront runs its department panels — the appliance stands
            on the light half, the name sits on the blue. No black anywhere. */}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cats.map((c, i) => {
            // A cutout can stand on the blue; a catalogue shot on white cannot,
            // so those departments get the light panel and multiply instead.
            const cutout = (categoryHeroes as Record<string, string>)[c.id];
            const shot = cutout || c.image || products.find((p) => p.category === c.name && p.image)?.image;
            return (
            <Reveal key={c.id} delay={(i % 3) * 70}>
              <Link href={`/categories/${c.id}`}
                className="card-lift group block h-full overflow-hidden rounded-[4px] border border-line bg-white">
                <div className={`relative aspect-[16/10] ${cutout
                  ? "bg-[linear-gradient(112deg,#1b3d7d_0%,#1b3d7d_46%,#eef2f9_46.2%,#eef2f9_100%)]"
                  : "bg-[linear-gradient(112deg,#dde4f3_0%,#dde4f3_46%,#f6f8fc_46.2%,#f6f8fc_100%)]"}`}>
                  {shot ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={shot} alt="" aria-hidden loading="lazy"
                      className={`absolute inset-0 h-full w-full object-contain p-7 transition-transform duration-700 group-hover:scale-105 ${cutout ? "drop-shadow-[0_14px_22px_rgba(0,0,0,.4)]" : "shot"}`} />
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-3 px-[22px] py-5">
                  <div>
                    <h3 className="font-display text-[25px] font-medium leading-[1.05] text-ink">{c.name}</h3>
                    <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-blue-deep">
                      {c.productCount} models
                    </p>
                  </div>
                  <ArrowRight size={20} className="shrink-0 text-blue transition-transform duration-300 group-hover:translate-x-1" />
                </div>
              </Link>
            </Reveal>
            );
          })}
        </div>
      </section>

      {/* ---------------- HERITAGE — the family story, like the reference site ---------------- */}
      <section className="mt-16 bg-blue px-6 py-24">
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
      <section className="container-x py-16">
        <Reveal className="mb-14 text-center">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.24em] text-blue-deep">— Simple &amp; clear</p>
          <h2 className="font-display text-[44px] font-normal">How it works</h2>
        </Reveal>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([num, title, body], i) => (
            <Reveal key={num} delay={i * 70} className="px-1">
              <div className="mb-4 font-mono text-[13px] tracking-[0.1em] text-blue">{num}</div>
              <div className="mb-5 h-px w-full bg-[linear-gradient(90deg,var(--color-blue),rgba(63,157,240,.1))]" />
              <h3 className="mb-2.5 font-display text-2xl font-medium">{title}</h3>
              <p className="text-sm leading-relaxed text-muted">{body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------------- BRAND TAPE — real logos, running like a showroom window ---------------- */}
      <section className="border-y border-line bg-paper-2 py-16">
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
      <section className="container-x py-24">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.24em] text-blue-deep">— Serving the local area</p>
            <h2 className="mb-5 font-display text-[44px] font-normal leading-[1.08]">
              Proudly serving Ruislip &amp; South Ruislip
            </h2>
            <p className="mb-7 text-base leading-relaxed text-muted">
              Our own local delivery and fitting covers Ruislip, South Ruislip, Eastcote, Northolt, Pinner,
              Ickenham and the surrounding HA postcodes. Because we deliver ourselves, we can talk you through
              dates, access and installation before anything leaves the shop.
            </p>
            <div className="flex flex-wrap gap-2.5">
              {AREAS.map((a) => (
                <span key={a} className="rounded-full border border-ink/15 px-4 py-2 text-[12.5px] font-medium">{a}</span>
              ))}
            </div>
          </div>
          <div className="rounded-[4px] border border-ink/10 bg-card p-9">
            <h3 className="mb-3 font-display text-[28px]">Are we in your area?</h3>
            <p className="mb-6 text-[14.5px] leading-relaxed text-muted">
              We deliver locally around {business.address.postcode} and the surrounding Ruislip postcodes.
              Rather than overpromise, we&apos;d sooner you call — we&apos;ll tell you honestly whether we cover
              you, what it costs and when we can come.
            </p>
            <a href={telHref(business.phone)}
              className="inline-flex items-center gap-2 bg-cta px-6 py-4 text-[15px] font-bold text-white transition-colors hover:bg-cta-deep">
              <Phone size={17} /> Call to check coverage
            </a>
          </div>
        </div>
      </section>

      {/* ------- SHOWROOM TOUR — the real shop, walkable (proof, not claims) ------- */}
      <section className="container-x max-w-[1080px] pb-24">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.24em] text-blue-deep">— The real shop</p>
        <h2 className="mb-5 font-display text-[44px] font-normal leading-[1.08]">
          Walk around our showroom, from your sofa
        </h2>
        <ShowroomTour />
      </section>

      {/* ---------------- CONTACT CTA ---------------- */}
      <section className="bg-navy">
        <div className="container-x mx-auto max-w-[900px] py-24 text-center">
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
    </>
  );
}
