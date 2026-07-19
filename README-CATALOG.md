# The catalogue — 1,577 products

## What's on the site

All three scraped catalogues are live, split by **real** product category:

| Source | Raw records | Notes |
|---|---:|---|
| `bosch_catalog.zip` | 836 | bosch-home.co.uk |
| `neff_catalog.zip` | 446 | neff-home.com |
| `ruislip_catalog.zip` | 321 | scraped appliance range |
| **Total raw** | **1,603** | |
| **Unique products live** | **1,577** | 26 were the *same* product in two feeds (see below) |

Nothing was dropped. The 26 difference is **de-duplication, not loss**: e.g. Bosch
`KFD96APEA` arrived from both the Bosch feed and the retailer feed. Same brand, same
model number, same appliance — listing it twice would show two identical tiles. The two
records are **merged** (price from whichever had one, the larger gallery, the longer
description), so nothing is lost.

Bosch/Neff twins of a shared BSH part number (224 of them) are **kept separate**, because
they're sold as different branded SKUs and customers search by their own appliance's brand.

## Categories

9 departments, 47 sub-categories, every product in exactly one leaf:

Laundry · Refrigeration · Dishwashers · Cooking · Coffee Machines · Floorcare ·
Small Appliances · TV & Audio · Accessories & Spare Parts

## Running it

```bash
npm run dev               # http://localhost:3005
```

> **Never run `npm run build` while `npm run dev` is up.** They share the `.next`
> directory, so the build replaces the dev server's chunks and the running site starts
> throwing `Cannot find module './627.js'` until you delete `.next` and restart.
> Use **`npm run build:check`** instead — it builds into `.next-check` and leaves the dev
> server (and any tunnel pointed at it) alone.

## Rebuilding

```bash
npm run catalog:build     # data/catalog-raw.json -> products/categories/brands.json
npm run catalog:report    # distribution, source balance, data gaps
npm run catalog:verify    # sweep every route on a running server
npm run build:check       # production build without touching a running dev server
npm test                  # includes catalogue integrity assertions
```

## Enquiries

The contact form posts to `/api/enquiries`. There is **no database** on this setup, so the
route falls back to appending each enquiry to `data/enquiries.jsonl` (git-ignored — it's
customer personal data). A form that silently 500s is the worst failure on a phone-first
shop, so the fallback matters. For production, wire an email provider (Resend/SendGrid) or
a hosted DB; a file won't persist on serverless hosting.

`catalog:build` **fails loudly** rather than mis-filing: any product it cannot classify
with confidence stops the build with the offending record printed.

## How classification works (`scripts/catalog/taxonomy.mjs`)

The folder names in the zips are misleading — Bosch's `Cooking` folder holds 340 items,
but most are oven lamps and baking trays, not ovens. So:

1. **Bosch / Neff** — the real taxonomy is in `source_url`
   (`/product/cooking/cooking-baking-accessories/…`), mapped via `URL_MAP`.
2. **Ruislip** — has no taxonomy at all (its `category` field is just the brand folder),
   so the product type is read out of the description with ordered rules.
3. **Content refinement** — runs on every source. Bosch and Neff are the same BSH parts
   catalogue under two brands; each feed files shared parts under its own URL tree, so the
   identical part would land in two different categories. The refinement rules key off the
   product text (identical in both feeds) so the twins always converge.
   `npm test` asserts **zero divergence** across all shared codes.

### Traps the rules deliberately handle

- `AirFry` is a **feature** on built-in Miele/Hotpoint ovens; `Air Fryer` is a worktop
  machine. Matching bare "air fry" filed a £1,399 Miele oven under Small Appliances.
- A Ninja *"Multifunction Oven"* / *"Mini Oven"* is a small appliance, not a built-in oven.
- *"Vacuum Cleaner Bags"* are accessories, not a vacuum.
- A Ninja *"FrostVault Cooler"* is a cool box, not a wine cooler.
- *"Double Oven Electric Cooker with Ceramic Hob"* is a cooker — not an oven, not a hob.
- *"Hob Extractor"* is a cooker hood.
- Some titles arrive with no spaces (`Series6FreestandingWashingMachine`), so text is
  matched against a de-concatenated copy too.
- One washing machine never says "washing machine" — it only says `11kg 1400 spin`.

## Images

11,754 images extracted to `public/catalog/<source>/<model>/` — **2.57 GB**. They are
served as static files. Six products have no image anywhere in the source and fall back to
a graphite tile showing the category name.

> If the repo size is a problem, these are the thing to move to a CDN or downsample —
> nothing else in the project is large.

## Known data-quality issues (faithful to the source, NOT invented)

These prices are exactly what the scrape captured; they were **not** corrected, because
guessing at prices on a shop's website would be worse than showing the source value:

- `Long Life odor filter (replacement) 3 pcs` — **£997.86** (and one at £1,319.09).
  Both the Bosch and Neff twins carry the same figure, so it parsed correctly; the source
  itself looks wrong. Real-world these filters are ~£100.
- 173 products have **no price** and render as "Call for price".
- Availability (`In stock` / `Limited availability`) comes from the **manufacturer's**
  website, not the shop's till. Nothing on the site states stock as fact — every product,
  every state, says *call to confirm*. `npm test` asserts this.
