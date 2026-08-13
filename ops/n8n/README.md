# n8n — price watch collector

`price-watch-euronics.json` is the nightly collector. It asks our app which
products to check, looks each one up on euronics.co.uk, and posts what it saw
back to `/api/price-ingest/observations`. It **never** changes a price — it only
reports. Everything about applying a price lives in the app (see
[`README-PRICE-WATCH.md`](../../README-PRICE-WATCH.md)).

---

## The server this runs on

| | |
|---|---|
| Host | Oracle Cloud Free Tier VM, `uk-london-1` |
| OS | Ubuntu 24.04 |
| RAM | ~1 GB + 2 GB swap |
| Container | `n8n-n8n-1`, Docker |
| Bind | `127.0.0.1:5678` — **localhost only, no reverse proxy, no TLS** |
| Egress IP | `145.241.246.216` |

Two facts measured from this box that shape the whole design:

- **currys.co.uk returns 403.** Cloudflare blocks datacentre IPs. Currys is not a
  usable source from here and — separately — their terms forbid scraping. Do not
  try to work around either.
- **euronics.co.uk returns 200.** Search and product pages both respond normally
  to a plain request with an honest User-Agent.

---

## Import it

1. Open n8n (see [Reaching the UI safely](#reaching-the-ui-safely) — do **not**
   open port 5678).
2. **Workflows → ⋯ → Import from File** → `price-watch-euronics.json`.
3. It imports **inactive**. Leave it that way until step 4 and the test run pass.
4. Set the environment (below), restart the container, then run it manually once
   with `PRICE_WATCH_MAX_PRODUCTS=2`.
5. Only then toggle **Active**.

There are no n8n *credentials* to create. Auth is HMAC computed inside Code
nodes from environment variables, so there is nothing sitting in n8n's
credential store to leak.

---

## Environment

All of this goes on the **n8n container**, not the Next.js app.

```yaml
# docker-compose.yml  (n8n service)
environment:
  # ── REQUIRED. Without this the Code node cannot require("crypto") and every
  #    run dies at "Sign Worklist Request" with a clear error message.
  - NODE_FUNCTION_ALLOW_BUILTIN=crypto

  # ── Must stay false (it is the default). The signing nodes read $env.
  - N8N_BLOCK_ENV_ACCESS_IN_NODE=false

  # ── Where our app lives.
  - PRICE_WATCH_APP_URL=https://www.kitchen-appliances.co.uk

  # ── The PriceSource row id for Euronics. No default on purpose: guessing an
  #    id would file observations against the wrong source.
  - PRICE_WATCH_EURONICS_SOURCE_ID=<paste the id from the admin>

  # ── The shared secret for machine key "collector". Must match
  #    PRICE_INGEST_SECRET_COLLECTOR in the app's environment, byte for byte.
  - PRICE_INGEST_SECRET_COLLECTOR=<48 random bytes, base64url>

  # ── Politeness. Defaults shown; the workflow refuses to start if you set
  #    min delay below 3000ms or max products above 200.
  - PRICE_WATCH_MAX_PRODUCTS=40
  - PRICE_WATCH_MIN_DELAY_MS=6000
  - PRICE_WATCH_MAX_DELAY_MS=14000
  - PRICE_WATCH_USER_AGENT=RuislipKitchenAppliancesPriceWatch/1.0 (+https://www.kitchen-appliances.co.uk/; ops@kitchen-appliances.co.uk)

  # ── Clock. The signature window is 300s; a drifting clock fails as a 401,
  #    which looks exactly like a wrong secret. TZ matters for the 03:17 cron.
  - GENERIC_TIMEZONE=Europe/London
  - TZ=Europe/London

  # ── 1 GB of RAM. Without pruning, execution history fills the SQLite file
  #    and the container starts OOM-ing weeks later for no visible reason.
  - EXECUTIONS_DATA_PRUNE=true
  - EXECUTIONS_DATA_MAX_AGE=168        # hours = 7 days
  - EXECUTIONS_DATA_PRUNE_MAX_COUNT=200
  - N8N_DEFAULT_BINARY_DATA_MODE=filesystem
```

Generate the secret the same way the app generates `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Then check the host clock, because a 401 caused by drift wastes an afternoon:

```bash
timedatectl status          # want: "System clock synchronized: yes"
docker exec n8n-n8n-1 date  # want: within a second or two of the host
```

---

## The signature the app must verify

Both requests use the same three headers:

| Header | Value |
|---|---|
| `x-pw-key` | `collector` |
| `x-pw-timestamp` | unix **seconds**, as a string |
| `x-pw-signature` | `hex( HMAC_SHA256( secret, ` `` `${timestamp}.${rawBody}` `` ` ) )` |

Two details that will otherwise cost you a debugging session:

- **The GET signs an empty body.** `rawBody` is `""` — not `"null"`, not `"{}"`.
  The worklist route must read the raw body the same way. The query string
  (`?limit=&sourceId=`) is **not** signed; it is a hint, and the server decides
  the real worklist.
- **The POST sends the exact bytes it signed.** The `POST Observations` node uses
  `contentType: raw`, not n8n's JSON body builder. If anything re-serialises the
  payload between signing and sending, one reordered key changes the hash and the
  route returns 401. Verified locally: `JSON.stringify(JSON.parse(body))` with a
  different key order produces a different string.

Route authorisation is separate from the signature. Key `collector` is only
allowed on the observations route; a valid signature from a key that is not
listed for the route is still a **403**. That is deliberate.

---

## Reaching the UI safely

n8n is bound to `127.0.0.1:5678` with **no TLS and no reverse proxy**. That is
the correct state. Keep it.

> **Do not publish port 5678.** An n8n instance reachable from the internet
> without auth is a remote code execution box with your API secrets in its
> environment — the Code node runs arbitrary JavaScript and the HTTP node makes
> arbitrary requests. It will be found; the internet-wide scanners check 5678.
> Opening it "just for five minutes to check something" is how it happens.

### Option A — SSH tunnel (recommended, and free)

Nothing to install, nothing new exposed, no certificate to renew.

```bash
ssh -N -L 5678:127.0.0.1:5678 ubuntu@145.241.246.216
# then browse http://localhost:5678 on your own machine
```

The listening socket stays on loopback on the server; the only open port remains
22. For a shop that touches n8n a few times a month, this is the whole answer.

### Option B — Caddy + TLS, if it genuinely needs to be a URL

Only worth it if more than one person needs access without SSH keys.

```
# /etc/caddy/Caddyfile
n8n.example.co.uk {
    reverse_proxy 127.0.0.1:5678
}
```

Then, all of the following — not a subset:

1. Point `n8n.example.co.uk` at `145.241.246.216`. Caddy gets the certificate
   automatically; **do not** terminate TLS yourself and do not skip it. n8n
   login is a password in a form field.
2. Open **443 only**, in *both* places — Oracle Cloud's VCN security list *and*
   the VM's own firewall. Ubuntu on OCI ships iptables rules that block
   everything but 22, so a security-list change alone silently does nothing:
   ```bash
   sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
   Leave 5678 closed at both layers — Caddy reaches it over loopback.
3. Turn on n8n's own auth and keep the container bound to loopback:
   ```yaml
   - N8N_HOST=n8n.example.co.uk
   - N8N_PROTOCOL=https
   - WEBHOOK_URL=https://n8n.example.co.uk/
   - N8N_SECURE_COOKIE=true
   ```
   Create the owner account on first load, immediately. n8n's setup screen is
   open to whoever reaches it first.
4. Add IP restriction at Caddy if the shop has a static IP:
   ```
   @notus not remote_ip 203.0.113.4
   respond @notus 404
   ```

Note that this is a *different* trust boundary from the app's admin. The app's
`middleware.ts` allowlist covers `/admin` and `/api/admin` only —
`/api/price-ingest/*` is deliberately outside it, because this machine's egress
IP is not the shop's office IP and machine routes must not depend on an IP
allowlist. The ingest routes are protected by HMAC instead. Do not "fix" this by
adding the ingest paths to the middleware; it will lock out the collector.

---

## What the workflow does, node by node

| # | Node | Type | What it does |
|---:|---|---|---|
| 1 | Nightly Trigger | `scheduleTrigger` | Cron `17 3 * * *`, Europe/London. Off-the-hour deliberately. |
| 2 | Run Config | `code` | Every knob in one place. Validates the caps and **refuses to start** if they are unsafe. Resets the run accumulator. |
| 3 | Sign Worklist Request | `code` | HMAC over `` `${ts}.` `` (empty body). Throws a specific error if `crypto` is unavailable or the secret is missing. |
| 4 | GET Worklist | `httpRequest` | `GET /api/price-ingest/worklist`. `neverError` so a 401 arrives as data. |
| 5 | Worklist To Items | `code` | One item per product. Applies the cap a second time — two independent caps, because a bug in either one otherwise means an uncapped crawl. |
| 6 | Loop Products | `splitInBatches` | `batchSize: 1`. This *is* the concurrency control. Output 0 = done, output 1 = loop. |
| 7 | Polite Delay | `code` | Randomised 6–14s. Also the halt checkpoint at the top of each iteration. |
| 8 | Search Euronics | `httpRequest` | `GET /search?text=<productCode>`. |
| 9 | Parse Search HTML | `code` | Finds `/catalogue/…/p/<SKU>` links, prefers one whose SKU contains the product code. |
| 10 | IF Search Blocked | `if` | 403 / 429 / 503 / Cloudflare challenge → exit the loop. |
| 11 | IF Product Found | `if` | No link → `not_found`, recorded, next product. |
| 12 | Fetch PDP | `httpRequest` | The second and last request for this product. |
| 13 | Extract Price | `code` | Primary + fallback extraction (below). Records the observation. |
| 14 | IF PDP Blocked | `if` | Same block rule on the PDP branch. |
| 15 | Record Not Found | `code` | Stores the miss rather than dropping it. |
| 16 | Record Blocked And Halt | `code` | Sets the halt flag, exits the loop **into the flush** so partial results survive. |
| 17 | Build Observation Batch | `code` | Builds the exact JSON string that gets signed and sent. Caps at 500. |
| 18 | Sign Observations Post | `code` | HMAC over `` `${ts}.${rawBody}` ``, timestamp generated *here* — a batch signed 15 minutes earlier would be outside the replay window. |
| 19 | POST Observations | `httpRequest` | `contentType: raw`. See above. |
| 20 | Run Summary | `code` | Clears the accumulator and **throws** on a halted or rejected run, so it shows as a failed execution. |

### Price extraction

**Primary** — the structured value embedded in the page:

```
"price": "349.0"
```

**Fallback** — the visible currency figure, `£349.00`. It is second for a
reason: a product page carries the was-price, a finance-per-month figure,
delivery, and warranty prices, all in pounds. Taking the first or the largest is
a coin toss. The fallback takes the **most frequently repeated** plausible
figure, because a current price is normally printed several times (header,
sticky bar, basket button), and drops `matchConfidence` by 0.25 to say honestly
that it is a weaker read.

Tested against the real page shape:

```
visible £ figures: [429, 349, 349, 349, 14.54, 4.99, 59]
modal £          : 349 x3
```

It correctly ignores the £429 was-price, the £14.54 finance figure and the
£4.99 delivery. When the structured value *is* present and the printed figure
agrees, that counts as corroboration; when they disagree, confidence drops 0.2
and the note says so.

**Nothing is dropped silently.** Every product ends as one observation with a
status: `ok`, `not_found`, `parse_failed`, or `blocked`. A collector that quietly
reports on 6 of 40 products is worse than one that fails.

### Politeness, concretely

- 1 request at a time. `batchSize: 1`, never raise it.
- 6–14s randomised between products, ~2 requests per product → 40 products is
  roughly 13 minutes of traffic, once a night, from one IP. That is the load of
  a single slow human browsing.
- HTML only. No images, CSS, or JS assets are fetched.
- Honest User-Agent with a contact address. Not a spoofed browser string — a
  spoofed UA is the difference between "a shop checking prices" and "a bot
  evading detection", and that distinction matters if anyone ever asks.
- Hard caps validated at startup: the run **refuses to begin** below 3s delay or
  above 200 products.

> This workflow does **not** fetch or obey `robots.txt`. Read
> `https://www.euronics.co.uk/robots.txt` yourself before enabling it, and read
> the terms question in `README-PRICE-WATCH.md`.

### On a 403

Stop. Not retry, not back off and continue.

The blocked product is recorded with status `blocked`, the halt flag is set, the
loop is exited into the flush so everything already collected still gets posted,
and then `Run Summary` throws so the execution shows red. A 403 from Cloudflare
is the source saying stop; retrying is how a temporary block becomes a permanent
one. There is no price on that site worth losing access over.

The same applies to 429, 503, and a `200` that is actually a bot-challenge page —
all three are treated as blocked.

---

## Test run

```
PRICE_WATCH_MAX_PRODUCTS=2
```

Restart, then **Execute Workflow** by hand and read every node's output. You are
checking four things:

1. `GET Worklist` returned 200 with products — not 401.
2. `Parse Search HTML` found a `/p/` link and `matchConfidence` is 0.9, not 0.4.
   0.4 means it fell back to "first result", which is worth eyeballing.
3. `Extract Price` shows `structured: <n>` in the note, corroborated by the £
   figure.
4. `POST Observations` returned 2xx.

Then put `PRICE_WATCH_MAX_PRODUCTS` back and activate.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `cannot require("crypto")` | `NODE_FUNCTION_ALLOW_BUILTIN=crypto` missing. Restart after adding it. |
| Every run 401s | Secret mismatch, or container clock drift past the 300s window. Check `docker exec n8n-n8n-1 date` before you check the secret. |
| 403 from our own ingest route | Valid signature, wrong key for the route. `collector` may post observations only. |
| `setTimeout is not defined` in Polite Delay | Older n8n Code sandbox. Replace that node with `n8n-nodes-base.wait` — you lose the jitter, so lower the rate to compensate. |
| Runs go red with "Run stopped early" | Working as designed. Euronics blocked us. Leave it off for a few days; do not lower the delay. |
| Lots of `not_found` | Our `productCode` is not the code Euronics indexes. Fix the codes, or accept that Euronics cannot benchmark those lines. |
| Container OOMs after a few weeks | Execution-data pruning not set. See the env block. |

---

## Adding a second source later

Copy the workflow, change `origin` / `searchBase` / the link and price regexes in
the two parse nodes, and give it its **own** `PriceSource` row. Do not point two
workflows at one source id — `lastRunStatus` becomes meaningless and you lose the
ability to disable one of them.

Do not add Currys. It 403s this server, and their terms forbid it.
