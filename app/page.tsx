import Link from "next/link";
import { Phone, ArrowRight, Wrench, Recycle, Truck } from "lucide-react";
import { loadCatalog } from "@/lib/repo";
import { topCategories, childCategories, toCardItem, poaNamesFrom } from "@/lib/select";
import { telHref } from "@/lib/format";
import Reveal from "@/components/Reveal";
import RotatingWord from "@/components/RotatingWord";
import CountUp from "@/components/CountUp";
import ShowroomReel from "@/components/ShowroomReel";
import DiscoverPanel from "@/components/DiscoverPanel";
import PostcodeCheck from "@/components/PostcodeCheck";
import GoogleReviews from "@/components/GoogleReviews";
import ShowroomTour from "@/components/ShowroomTour";
import ProductCard from "@/components/ProductCard";
export const revalidate = 300;

const STEPS = [
  ["01", "Choose your appliance", "Browse the range and find the model that fits your kitchen."],
  ["02", "Check price & details", "See the price, product code and specs up front."],
  ["03", "Call to confirm stock", "Quote the code and we'll check live availability for you."],
  ["04", "Arrange delivery / fitting", "We book in delivery and installation that suits you."],
];

const AREAS = ["Ruislip", "South Ruislip", "Eastcote", "Northolt", "Pinner", "Ickenham", "Ruislip Manor"];

// The hero headline rolls through the real departments — merchandising in the
// H1 itself. Assistive tech and crawlers read the static "appliances" instead.
const HERO_WORDS = [
  "washing machines", "fridge freezers", "ovens & hobs", "dishwashers",
  "coffee machines", "TVs & soundbars", "vacuum cleaners", "appliances",
];

/** Never front the shop with a spare part — a water-hardness test strip is not a showcase. */
const ACCESSORIES = "Accessories & Spare Parts";

export default async function Home() {
  const { products, categories, brands, business } = await loadCatalog();
  const cats = topCategories(categories);

  // One flagship (dearest, photographed) per real appliance department, so the
  // shelf reads as a showroom rather than a bin of filters. Call-for-price
  // categories are excluded — the slideshow leads with the price.
  const poaSet = poaNamesFrom(categories);
  const realCats = cats.filter((c) => c.name !== ACCESSORIES);
  const featured = realCats
    .map((c) =>
      products
        .filter((p) => p.category === c.name && p.image && p.priceNow !== null &&
          !poaSet.has(p.category) && !poaSet.has(p.subcategory))
        .sort((a, b) => (b.priceNow ?? 0) - (a.priceNow ?? 0))[0]
    )
    .filter(Boolean)
    .slice(0, 8);

  // Best offers — real was/now savings, dearest saving first. The owner asked
  // for value over "premium": lead with what people actually save.
  const offers = products
    .filter((p) => p.image && p.priceNow !== null && p.priceWas !== null && (p.saving ?? 0) > 0 &&
      !poaSet.has(p.category) && !poaSet.has(p.subcategory))
    .sort((a, b) => (b.saving ?? 0) - (a.saving ?? 0))
    .slice(0, 8)
    .map((p) => toCardItem(p, poaSet));

  const reelProducts = featured.concat(
    products.filter((p) => p.image && p.priceNow !== null && !featured.includes(p)).slice(0, 20)
  );

  // Department -> sub-category names for the finder; one vocabulary with the
  // category pages and the /products browser.
  const departments = cats.map((c) => ({
    name: c.name,
    subs: childCategories(categories, c.id).map((s) => s.name),
  }));

  return (
    <>
      {/* ------- HERO — one solid royal band, the finder front and centre.
                 The layout the owner chose leads with "help me find it",
                 not with a film. ------- */}
      <section className="bg-blue">
        <div className="container-x flex flex-col gap-7 py-14 lg:py-[72px]">
          <div className="reveal max-w-[860px]">
            <p className="mb-4 inline-flex items-center gap-2 border border-white/20 px-3.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.22em] text-sky">
              <span className="h-1.5 w-1.5 rounded-full bg-cta" /> Euronics Ruislip · South Ruislip · since 1977
            </p>
            <h1 className="font-display text-[clamp(30px,4vw,50px)] leading-[1.08] text-white">
              Big-brand <RotatingWord words={HERO_WORDS} fallback="appliances" className="text-sky" />,{" "}
              <em className="shimmer not-italic italic">honest local prices.</em>
            </h1>
            <p className="mt-4 max-w-[560px] text-[15.5px] leading-relaxed text-white/80">
              Browse {products.length.toLocaleString("en-GB")} appliances, check the price and product code,
              then call us — we confirm stock, delivery and fitting in one conversation.
            </p>
          </div>

          <div className="reveal">
            <DiscoverPanel departments={departments} />
          </div>

          <div className="reveal flex flex-wrap items-center gap-3">
            <a href={telHref(business.phone)}
              className="inline-flex items-center gap-2.5 bg-cta px-6 py-[13px] text-sm font-bold text-white transition-colors hover:bg-cta-deep">
              <Phone size={16} /> Call {business.phone}
            </a>
            <Link href="/products"
              className="group inline-flex items-center gap-2 border border-white/30 px-6 py-[13px] text-sm font-semibold text-white transition-colors hover:border-white hover:bg-white hover:text-blue">
              Browse everything
              <ArrowRight size={16} className="transition-transform duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] group-hover:translate-x-[3px]" />
            </Link>
          </div>

          {/* honest inline coverage check — replaces the old auto-opening modal */}
          <div className="reveal">
            <PostcodeCheck phone={business.phone} />
          </div>
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

      {/* real Google reviews only — renders nothing until genuine data exists */}
      <GoogleReviews />

      {/* ---------------- SHOWROOM REEL (the design movement) ---------------- */}
      <ShowroomReel products={reelProducts} />

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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {cats.map((c, i) => (
            <Reveal key={c.id} delay={(i % 4) * 70}>
              <Link href={`/categories/${c.id}`}
                className="card-lift group relative block aspect-[3/4] overflow-hidden rounded-[4px] bg-navy-2">
                {c.image ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={c.image} alt="" aria-hidden loading="lazy"
                    className="absolute inset-0 h-full w-full object-contain p-8 opacity-90 transition-transform duration-700 group-hover:scale-105" />
                ) : null}
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,24,48,.15)_30%,rgba(4,24,48,.9))]" />
                <div className="absolute inset-x-0 bottom-0 p-[22px]">
                  <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-sky">
                    {c.productCount} models
                  </p>
                  <h3 className="font-display text-[25px] font-medium leading-[1.05] text-paper">{c.name}</h3>
                </div>
              </Link>
            </Reveal>
          ))}
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

      {/* ---------------- BRAND GRID — real logos, like the reference site ---------------- */}
      <section className="border-y border-line bg-paper-2 py-16">
        <div className="container-x">
          <Reveal className="mb-9 text-center">
            <p className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.24em] text-blue-deep">— The brands we stock</p>
            <h2 className="font-display text-[40px] font-normal">{brands.length} trusted appliance brands</h2>
          </Reveal>
          <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
            {[...brands].sort((a, b) => b.productCount - a.productCount).map((b, i) => (
              <Reveal key={b.id} delay={(i % 7) * 70}>
                <Link href={`/brands/${b.slug}`} title={`${b.name} — ${b.productCount} models`}
                  className="card-lift flex h-[72px] items-center justify-center rounded-lg border border-line bg-white px-5">
                  {b.logo ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={b.logo} alt={`${b.name} logo`} loading="lazy" className="max-h-[38px] max-w-[80%] object-contain" />
                  ) : (
                    <span className="text-center text-[15px] font-bold uppercase tracking-[0.08em] text-navy">{b.name}</span>
                  )}
                </Link>
              </Reveal>
            ))}
          </div>
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
