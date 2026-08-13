# Price watch

We list a Beko CCFM4552W at **£299**. Euronics lists the same appliance at
**£349**. Nobody noticed, because nobody checks 1,577 products by hand.

That is the problem this feature solves — and the only problem it solves. It
tells you what other people charge. It does not decide what you charge.

---

# Part 1 — For the shop owner

*(Plain English. Two minutes. The developer section is after this.)*

## What it does

Once a night, at about quarter past three in the morning, a small program looks
up some of your products on the Euronics website and writes down what it sees:
their price, whether it says in stock, and the page it read it from. It writes
all of that into your own database.

Then it stops. That is the whole job.

In the admin you get a list: *here is a product, here is your price, here is
theirs, here is the difference.* You look at it with your morning coffee and you
decide what to do.

## What it will never do

**It will never change a price on your website by itself.**

Not "usually not". Not "only for small changes". Never — and not because we
trust ourselves to remember, but because the code physically refuses. Before any
price could ever be applied automatically, *all* of these must be true:

- You have entered a **cost price** for that product. If we do not know what you
  paid, we cannot know whether a price loses you money, so we will not touch it.
  Right now no product has a cost price, which means **auto-apply is impossible
  today for every single product in the shop.**
- The price is above your **floor** — your cost plus the minimum margin you set.
- The source is one you have marked as trusted. Euronics is set up as
  *advisory*, which by itself is enough to block any automatic change forever.
- The product is not a "call for price" line.
- The reading is less than a week old, we know the delivery cost, and the price
  did not move by more than a third overnight.

Miss any one and it does not happen. It shows you the number and waits.

You should assume you will be approving every change by hand, and that this is
correct. The value here is *knowing*, not *automating*.

## What it might get wrong

- It matches products by model number. Sometimes it will find the wrong
  appliance, or none at all. When it is unsure it says so — a "confidence" figure
  — and when it finds nothing it records "not found" rather than pretending.
- Their price on screen may not include delivery. We record delivery as
  *unknown*, because Euronics does not state it on the page, and guessing zero
  would make every comparison quietly wrong.
- If Euronics blocks us one night, the run stops immediately and tells you. It
  does not keep trying.

## Four decisions only you can make

1. **Will you enter cost prices?** Until you do, this is a comparison report and
   nothing more. That is a perfectly reasonable place to stop. But everything
   protective in the system is built on knowing your cost.
2. **What is your minimum margin?** The default is 12%. It is a guess. Tell the
   developer the real number, per category if it varies.
3. **Do you want automatic changes at all — ever?** You can leave them switched
   off permanently. Many shops should.
4. **Is this something you want to do?** See the honesty section at the end of
   this document. Reading a competitor's public website may be against that
   website's terms, and there are licensed ways to get the same information. Read
   that bit before switching it on.

---

# Part 2 — For the developer

## Shape

```
n8n (Oracle VM, nightly)                     Next.js app
────────────────────────                     ───────────────────────────────
Nightly Trigger
  │
  ├─ GET  /api/price-ingest/worklist  ─────▶ machine-auth → which products?
  │                                  ◀───── [{productId, productCode, …}]
  │
  ├─ for each product, 1 at a time, 6–14s apart:
  │     euronics.co.uk/search?text=<code>
  │     euronics.co.uk/catalogue/…/p/<SKU>
  │     extract price → observation
  │
  └─ POST /api/price-ingest/observations ──▶ machine-auth → PriceObservation[]
                                                     │
                                             admin review page
                                                     │
                                             lib/price-watch/guards.ts
                                                     │
                                             human clicks Apply → Product.priceNow
                                                                → writeAudit
                                                                → revalidateStorefront
```

Four pieces, four owners:

| Piece | File | Role |
|---|---|---|
| Machine auth | `lib/machine-auth.ts` | HMAC + per-key route allowlist |
| Guards | `lib/price-watch/guards.ts` | Decides whether a proposal *may* be applied |
| Ingest routes | `app/api/price-ingest/*` | Worklist out, observations in |
| Collector | `ops/n8n/price-watch-euronics.json` | Gets the numbers |

The collector is the least important of the four and the only one that runs
outside our infrastructure. It is treated as untrusted input: it authenticates,
it is rate-limited by its own caps, and nothing it says is believed without the
guards.

## Trust boundaries

`middleware.ts` guards `/admin` and `/api/admin` with the IP allowlist.
`/api/price-ingest/*` is **deliberately outside it**. The collector's egress IP
(`145.241.246.216`, an Oracle Cloud VM) is not the shop's office IP, and putting
machine routes behind an office-IP allowlist would break them permanently.

Machine routes are protected by HMAC instead:

```
x-pw-key         collector
x-pw-timestamp   unix seconds
x-pw-signature   hex HMAC_SHA256(secret, `${timestamp}.${rawBody}`)
```

with a 300s replay window, `timingSafeEqual` comparison, a per-key secret in
`PRICE_INGEST_SECRET_<KEYID>` (no shared fallback, no allow-by-default), and a
per-key route allowlist. A valid signature from a key not listed for the route
is **403**, not 200. `collector` posts observations; it cannot post supplier
prices.

Do not "fix" the middleware gap by adding `/api/price-ingest` to it.

## Data

`PriceObservation` is append-only fact: what a source said, when, from what URL,
with what confidence. It is never overwritten and never rolled up into
`Product.priceNow` by any automatic path.

`Product` gained `costPrice`, `floorPrice`, and `gtin`. `costPrice` is the
keystone: **no cost price means no auto-apply, ever**, via the `no_floor_data`
guard. This is not a soft default — it is a blocking condition, and it is
currently true of every product in the catalogue.

Observation statuses, all of which are recorded rather than dropped:

| Status | Meaning |
|---|---|
| `ok` | We read a price. `matchConfidence` says how much to trust the match. |
| `not_found` | Source answered; no product page for this code. Real information. |
| `parse_failed` | Page loaded, price not extractable. Usually a layout change. |
| `blocked` | 403/429/503 or a bot challenge. The run stopped here. |

A collector that silently reports on 6 of 40 products looks identical to one
where 34 prices did not change. Hence the statuses.

## Guards

`evaluateGuards` returns `{ allowed, blocking[], warnings[], floor }`. Eight
conditions **block** — they do not warn:

| Guard | Blocks when |
|---|---|
| `below_floor` | proposed < effective floor. The one that matters. |
| `no_floor_data` | `costPrice` and `floorPrice` both null |
| `vat_basis_mismatch` | observation is ex-VAT, we advertise inc-VAT, no conversion applied |
| `unknown_delivery` | `deliveryCost` null while comparing landed prices from an advisory source |
| `advisory_source` | `sourceKind !== "authorised"` — Euronics is advisory, so this alone blocks everything from it |
| `poa_category` | category or sub-category is price-on-application (`lib/poa.ts`) |
| `stale_observation` | `observedAt` older than 7 days |
| `implausible_move` | \|proposed − current\| / current > 0.35 |

`implausible_move` is a **scraper sanity check, not a margin control**. It exists
to catch "we parsed the finance-per-month figure as the price", not to cap
discounts. Do not tune it as if it were a pricing policy; `below_floor` is the
pricing policy.

### The floor, and why it is written that way

```
floor_ex_vat = cost / (1 − minMarginPct)
floor        = floor_ex_vat × (1 + vatRate)
```

Defaults: `vatRate` 0.20, `minMarginPct` 0.12.

This is **true margin**, and the division is the whole point. Selling at
`floor_ex_vat`:

```
realised margin = (floor_ex_vat − cost) / floor_ex_vat
                = (cost/(1−m) − cost) / (cost/(1−m))
                = 1 − (1 − m)
                = m                                   ✓ exactly the configured number
```

The tempting version, `cost × (1 + m)`, is **markup**, not margin. At `m = 0.12`
it realises `m/(1+m)` = **10.7%**, so a floor that claims to protect 12% quietly
protects a tenth less. On a £900 appliance that is about £12 a unit, every unit,
invisibly. Name it honestly in the code and the maths stays honest.

## Why Euronics, and the case that started it

Verified live from the collector VM on 2026-08-13:

- `currys.co.uk` → **403**. Cloudflare blocks datacentre IPs.
- `euronics.co.uk` → **200**. Search and PDP both fine.
- `…/beko-ccfm4552w-…/p/BEKCCFM4552W` contains both `£349.00` and
  `"price": "349.0"`.
- Our price: **£299**.

That is a 16.7% gap — under the `implausible_move` threshold, so it reaches a
human rather than being discarded as a parse error. And because Euronics is an
*advisory* source with unknown delivery and no cost price on the product, all
three of `advisory_source`, `unknown_delivery` and `no_floor_data` block any
automatic application. The system's answer to its own founding example is
"here is the number, a person decides" — which is the correct answer.

## Extraction

Primary is the structured `"price": "349.0"`. Fallback is the visible `£349.00`,
taking the **modal** figure rather than the first or largest, because a PDP
carries the was-price, finance-per-month, delivery and warranty figures too.
Tested against the real page shape:

```
visible £ figures: [429, 349, 349, 349, 14.54, 4.99, 59]  →  modal 349 ×3
```

Fallback costs 0.25 of `matchConfidence`; disagreement between the two methods
costs another 0.2 and is written into the observation note. Full detail in
[`ops/n8n/README.md`](ops/n8n/README.md).

## Operational rules

- **One request at a time**, 6–14s apart, HTML only, honest User-Agent with a
  contact address. The run refuses to start below a 3s delay or above 200
  products.
- **A 403 stops the run.** The partial batch is still posted, then the execution
  is failed on purpose so it shows red. No retry, no backoff-and-continue.
- The collector never writes to `Product`. Its only write path is
  `PriceObservation` rows via an authenticated route.

---

## Honesty: is this allowed?

This deserves a straight answer rather than a disclaimer.

**Automated collection of a retailer's prices may breach that retailer's terms of
use**, whether or not the pages are public and whether or not you are polite
about it. Politeness — one request at a time, a real User-Agent, a nightly cap —
reduces the operational risk of being blocked. It does not change the contractual
position. Nobody should read this document as a legal opinion; if the shop is
going to rely on this commercially, it is worth twenty minutes of a solicitor's
time.

**Currys specifically forbids it**, and separately blocks this server outright
(403 from Cloudflare). Both facts are in the workflow's README. Do not add
Currys, and do not route around the block with a residential proxy or a spoofed
browser User-Agent — that converts an operational obstacle into a deliberate
circumvention, which is a materially different thing.

**Euronics answers our requests normally.** That is not the same as permission.
Read `https://www.euronics.co.uk/robots.txt` before enabling the workflow; it
does not parse or obey robots.txt on your behalf.

### The licensed routes, which are better anyway

1. **CIH / Euronics member data export.** The shop is in the buying group.
   Members can get product and pricing data through the group's own channels —
   contractually clean, better structured than HTML, and it includes cost data
   the website can never give you, which is exactly the input every guard in this
   system is starved of. Ask your CIH account contact for the data feed options.
2. **Google Merchant Center price benchmarks.** Free with a product feed. Google
   reports the benchmark price other merchants charge for the same GTIN — which
   is why `Product.gtin` is in the schema. No scraping, no terms question, and
   broader coverage than one competitor.

Both give you the same insight with none of the exposure. **The scraper is the
stopgap, not the destination.** If either licensed route comes through, retire
`price-watch-euronics.json` — the ingest routes, guards, and admin review screen
all keep working unchanged, because they were built to take observations from any
source. Point a feed importer at the same endpoint and delete the workflow.
