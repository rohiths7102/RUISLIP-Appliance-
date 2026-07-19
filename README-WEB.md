# Kitchen Appliances — Premium Web (Next.js)

Slice 2 foundation: Next.js 15 (App Router) + React 19 + Tailwind v4, premium
graphite/ivory/brass design, real routing, phone-first (no cart/checkout),
correct store details, wired to the real seed data (35 products, 19 brands,
full category tree, business info).

## Run it
```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (currently passes, 90 static pages)
```
Node 18.18+ (20+ recommended).

## Routes
/  ·  /products  ·  /products/[slug]  ·  /categories  ·  /categories/[slug]
/brands  ·  /brands/[slug]  ·  /about  ·  /delivery-services  ·  /contact  ·  /admin  ·  404

## What's real vs. coming
- REAL now: premium UI, routing, search/filter/sort, product detail with code/
  price/was/saving/availability/warranty, phone-first CTAs, enquiry prefill by
  product code, LocalBusiness + Product JSON-LD, correct phone/address/hours.
- Data source is `data/*.json` (seed). Slices 3–6 move this to a Prisma/Postgres
  DB fed by the scraper, and add the admin console; Slices 8–9 add the RAG + Groq
  chatbot; Slice 11 adds redirects/sitemap; Slice 12 is full QA.

## Removed (per the "no fake" rule)
Shopping cart, fake urgency countdown, simulated "live buyer" ticker, and the
incorrect store address/phone that were in the old package.

## Known refinement
Sub-category URLs currently encode the slash (e.g. `laundry%2Fwashing-machines`).
Slice 6 switches categories to clean DB slugs / a catch-all route.
