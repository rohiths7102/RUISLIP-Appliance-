# Supplier sync — how products and prices stay current

Three suppliers, one pipeline. Nothing here can set a price on its own except
the owner: every collector only *observes*, and adoption runs through the
deterministic guards in `lib/price-watch/guards.ts`.

```
Euronics ─┐
Bosch ────┼─► collector ─► POST /api/price-ingest/observations ─► guards ─► /admin/price-watch ─► live
NEFF ─────┘                    (HMAC, cannot write priceNow)
```

---

## 1. Euronics

Bosch, NEFF and Siemens are **not** in the Euronics range (verified: 0 of 4,782).
They left the group, so Euronics data can never price them — that is what
section 2 is for.

**Coverage + price reconciliation**

```bash
node scripts/catalog/reconcile-euronics.mjs                    # coverage only, no writes
node scripts/catalog/reconcile-euronics.mjs --prices           # + current prices as observations
node scripts/catalog/reconcile-euronics.mjs --prices --brand smeg --limit 20
```

Writes `euronics-coverage.json`: what we carry, what is missing, by brand.

**Importing lines we don't carry**

```bash
node scripts/catalog/import-euronics-range.mjs --dry-run --limit 20
node scripts/catalog/import-euronics-range.mjs                 # the whole gap
```

Everything imported is `call_to_confirm` — the owner has not confirmed stock, so
the site must not imply it (this also keeps them out of the Google Shopping feed,
which requires a stock status he can stand behind).

Measured over the full range: **88.7% classify**; the rest is overwhelmingly
audio (DAB radios, turntables), which is outside the appliance taxonomy and is
skipped rather than forced. Of what classifies, **99.2% agrees with Euronics'
own department**.

---

## 2. Bosch / NEFF — the daily collector on Oracle

Their public product-page price **is** the price we show. ~1,300 pages at 1/sec
is far past any serverless budget, so this runs on the always-on Oracle box
beside n8n — not on Vercel.

### One-time setup

```bash
# on the Oracle box
git clone https://github.com/rohiths7102/RUISLIP-Appliance-.git
cd RUISLIP-Appliance-

export SITE_URL="https://ruislip-appliance.vercel.app"
export PRICE_INGEST_SECRET_COLLECTOR="<the secret>"
```

Set the **same** `PRICE_INGEST_SECRET_COLLECTOR` in Vercel → Project → Environment
Variables (Production), then redeploy once so the server can verify signatures.

The script needs no database credentials and imports nothing from the app — it
talks HTTPS only, so the box never holds DB access.

### Run it

```bash
node scripts/collector/daily-sync.mjs --source manufacturer-rrp --dry-run   # first run
node scripts/collector/daily-sync.mjs --source manufacturer-rrp
```

### n8n workflow

```
Cron 05:30
  → Execute Command:  node scripts/collector/daily-sync.mjs --source manufacturer-rrp
  → parse the last stdout line beginning `SUMMARY_JSON:`
  → Gemini: turn it into a sentence
  → Telegram: send to the owner
```

`SUMMARY_JSON` carries `{checked, priced, failed, changeCount, weAreOver,
weAreUnder, topChanges[], reviewUrl}`. Gemini writes the message; it is never
given authority to change a price.

Changes land in `/admin/price-watch`. In practice the volume is small — a sample
of 14 Bosch/NEFF products found all 14 already matching, so this is drift
detection, not bulk repricing.

---

## 3. Owner price updates (WhatsApp / Telegram) — built, dormant

`POST /api/price-ingest/owner-update`, two calls:

```jsonc
// 1. propose — nothing is written
{ "items": [{ "productCode": "WAN28259GB", "price": 429 }] }
// → { confirmToken, changes: [...], summary }

// 2. confirm — applies exactly that proposal
{ "items": [...], "confirmToken": "…" }
```

The token is bound to the exact item list, so an edited list needs a fresh
proposal. Call-for-price categories are refused; an ambiguous product code (198
BSH part numbers exist under both Bosch and NEFF) is refused rather than guessed;
swings over 50% are flagged before confirming. Every change is audited and
locked into `adminOverrideFields` so a later import cannot undo it.

**Inert until `PRICE_INGEST_SECRET_OWNER` is set** — the key resolves to null
without it and every request is rejected.

Personal WhatsApp has no API. Use Telegram (free, minutes to set up) or the
WhatsApp Business Cloud API. The endpoint is messenger-agnostic.

---

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `PRICE_INGEST_SECRET_COLLECTOR` | Vercel + Oracle | Daily supplier collector |
| `PRICE_INGEST_SECRET_OWNER` | Vercel + n8n | Owner price updates (optional) |
| `SITE_URL` | Oracle | Where the collector posts |

Secrets fail closed: a missing one rejects every request rather than allowing it.
