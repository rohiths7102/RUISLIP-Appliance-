import Link from "next/link";
import { Phone, ArrowRight } from "lucide-react";
import { loadCatalog } from "@/lib/repo";
import { topCategories, slugOf } from "@/lib/select";
import { telHref } from "@/lib/format";
import HeroVideo from "@/components/HeroVideo";
import Reveal from "@/components/Reveal";
import ShowroomReel from "@/components/ShowroomReel";
import ProductSlideshow, { type Slide } from "@/components/ProductSlideshow";
import PostcodeCheck from "@/components/PostcodeCheck";
import GoogleReviews from "@/components/GoogleReviews";
export const revalidate = 300;

// A real background video ships with the site: a 4K (3840×2160) cinematic loop
// rendered from the brand hero frame, plus a 1080p variant for small screens.
// To swap in a different brand film, set NEXT_PUBLIC_HERO_VIDEO (or replace the
// files in public/hero/) — nothing else changes.
const HERO_VIDEO = process.env.NEXT_PUBLIC_HERO_VIDEO || "/hero/hero.mp4";
const HERO_VIDEO_SMALL = "/hero/hero-1080.mp4";
const HERO_POSTER = "/hero/hero-poster-4k.jpg";

const STEPS = [
  ["01", "Choose your appliance", "Browse the range and find the model that fits your kitchen."],
  ["02", "Check price & details", "See the price, product code and specs up front."],
  ["03", "Call to confirm stock", "Quote the code and we'll check live availability for you."],
  ["04", "Arrange delivery / fitting", "We book in delivery and installation that suits you."],
];

const AREAS = ["Ruislip", "South Ruislip", "Eastcote", "Northolt", "Pinner", "Ickenham", "Ruislip Manor"];

/** Never front the shop with a spare part — a water-hardness test strip is not a showcase. */
const ACCESSORIES = "Accessories & Spare Parts";

export default async function Home() {
  const { products, categories, brands, business } = await loadCatalog();
  const cats = topCategories(categories);

  // One flagship (dearest, photographed) per real appliance department, so the
  // shelf reads as a showroom rather than a bin of filters.
  const realCats = cats.filter((c) => c.name !== ACCESSORIES);
  const featured = realCats
    .map((c) =>
      products
        .filter((p) => p.category === c.name && p.image && p.priceNow !== null)
        .sort((a, b) => (b.priceNow ?? 0) - (a.priceNow ?? 0))[0]
    )
    .filter(Boolean)
    .slice(0, 8);

  const reelProducts = featured.concat(
    products.filter((p) => p.image && p.priceNow !== null && !featured.includes(p)).slice(0, 20)
  );

  // The Amazon-style slideshow uses the same records the product pages render,
  // so price / code / link are in sync by construction.
  const slides: Slide[] = featured.map((p) => ({
    slug: slugOf(p),
    brand: p.brand,
    title: p.title,
    category: p.category,
    productCode: p.productCode,
    image: p.image,
    priceNow: p.priceNow,
    priceWas: p.priceWas,
    saving: p.saving,
  }));

  return (
    <>
      {/* ------- HERO — 4K video behind, product slideshow in front ------- */}
      <section className="relative flex min-h-[92vh] flex-col overflow-hidden bg-navy-3">
        <HeroVideo videoSrc={HERO_VIDEO} videoSrcSmall={HERO_VIDEO_SMALL} poster={HERO_POSTER} />
        <div className="absolute inset-0 z-[1] bg-[linear-gradient(180deg,rgba(4,16,31,.82)_0%,rgba(4,16,31,.45)_38%,rgba(4,16,31,.72)_100%)]" />
        <div className="absolute inset-x-0 top-0 z-[2] h-px bg-[linear-gradient(90deg,transparent,rgba(63,157,240,.6),transparent)]" />

        <div className="container-x relative z-[3] flex flex-1 flex-col justify-center gap-8 py-12">
          {/* compact headline row */}
          <div className="reveal flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.22em] text-sky backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-sky" /> Euronics Ruislip · South Ruislip · since 1977
              </p>
              <h1 className="font-display text-[clamp(30px,4vw,52px)] font-normal leading-[1.05] tracking-[-0.015em] text-[#f4f9ff]">
                Premium kitchen appliances, <em className="shimmer not-italic font-normal italic">real local service.</em>
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/products"
                className="group inline-flex items-center gap-2 rounded-full bg-[linear-gradient(118deg,#3f9df0_0%,#1173d4_46%,#0b4a8d_100%)] px-7 py-[14px] text-sm font-bold tracking-[0.03em] text-white shadow-[0_16px_42px_-14px_rgba(17,115,212,.7)] transition-[transform,box-shadow] duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] hover:-translate-y-0.5 hover:shadow-[0_22px_54px_-12px_rgba(17,115,212,.85)] active:translate-y-0">
                Browse {products.length.toLocaleString("en-GB")} appliances
                <ArrowRight size={16} className="transition-transform duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] group-hover:translate-x-[3px]" />
              </Link>
              <a href={telHref(business.phone)}
                className="inline-flex items-center gap-2.5 rounded-full border border-white/25 bg-white/5 px-6 py-[14px] text-sm font-semibold text-paper backdrop-blur-sm transition-colors hover:border-sky hover:text-sky">
                <Phone size={16} /> Call {business.phone}
              </a>
            </div>
          </div>

          {/* honest inline coverage check — replaces the old auto-opening modal */}
          <div className="reveal">
            <PostcodeCheck phone={business.phone} />
          </div>

          {/* the slideshow, front and centre over the video — calm 6s cadence */}
          <ProductSlideshow slides={slides} intervalMs={6000} className="reveal" />
        </div>
      </section>

      {/* ------- marketing stats band — every number is real ------- */}
      <div className="border-b border-line bg-white">
        <div className="container-x grid grid-cols-2 gap-y-8 py-11 text-center md:grid-cols-4">
          {[
            [products.length.toLocaleString("en-GB"), "appliances in the catalogue"],
            [String(brands.length), "trusted appliance brands"],
            ["1977", "serving Ruislip since"],
            ["Own van", "local delivery & fitting"],
          ].map(([big, label], i) => (
            <Reveal key={label} delay={i * 70} className="px-3">
              <div className="font-display text-[clamp(34px,4vw,52px)] font-semibold leading-none text-navy">{big}</div>
              <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-blue-deep">{label}</div>
            </Reveal>
          ))}
        </div>
      </div>

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

      {/* ---------------- MANIFESTO ---------------- */}
      <section className="mt-16 bg-navy px-6 py-28">
        <div className="mx-auto max-w-[1000px] text-center">
          <p className="mb-8 font-mono text-[11px] uppercase tracking-[0.24em] text-sky">
            — Why people keep coming back
          </p>
          <p className="font-display text-[clamp(28px,4.3vw,56px)] font-normal leading-[1.24] tracking-[-0.01em] text-paper">
            Since 1977 we have sold appliances the honest way. Real advice from people you can call,
            fair prices, and proper aftercare long after the box has gone.
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
              className="inline-flex items-center gap-2 rounded-sm bg-blue px-6 py-4 text-[15px] font-bold text-navy hover:bg-sky">
              <Phone size={17} /> Call to check coverage
            </a>
          </div>
        </div>
      </section>

      {/* ---------------- CONTACT CTA ---------------- */}
      <section className="relative overflow-hidden bg-navy">
        <div className="absolute inset-0 bg-[radial-gradient(80%_120%_at_50%_0%,rgba(63,157,240,.14),transparent_60%)]" />
        <div className="container-x relative z-[2] mx-auto max-w-[900px] py-24 text-center">
          <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.24em] text-sky">
            — Found something you like?
          </p>
          <h2 className="mb-6 font-display text-[54px] font-normal leading-[1.06] text-paper">
            Call to confirm availability
            <br />
            before you visit.
          </h2>
          <p className="mx-auto mb-9 max-w-[560px] text-[17px] leading-relaxed text-[#b6cce4]">
            Quote the product code and we&apos;ll check live stock, give you the best price and book in
            delivery or installation — all in one call.
          </p>
          <a href={telHref(business.phone)}
            className="group inline-flex items-center gap-3 rounded-full bg-[linear-gradient(118deg,#3f9df0_0%,#1173d4_46%,#0b4a8d_100%)] px-10 py-5 text-[17px] font-bold text-white shadow-[0_18px_44px_-14px_rgba(11,74,141,.55)] transition-[transform,box-shadow] duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] hover:-translate-y-0.5 hover:shadow-[0_24px_58px_-12px_rgba(17,115,212,.7)] active:translate-y-0">
            <Phone size={19} /> {business.phone}
            <ArrowRight size={18} className="transition-transform duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] group-hover:translate-x-[3px]" />
          </a>
        </div>
      </section>
    </>
  );
}
