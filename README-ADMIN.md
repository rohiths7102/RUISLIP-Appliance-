# The owner's admin panel

The shop owner manages the website from **`/admin`** — no developer needed.

```
http://localhost:3005/admin
```

Real, database-backed. Every change is live on the storefront on the next page load.

## Before you share the site — SECURITY

The panel can **change prices, upload files and delete products**, so it must not ship on
the default login (`admin@local` / `admin`).

```bash
node scripts/hash-password.mjs "a-strong-password"
# paste the printed line into .env, e.g.
#   ADMIN_PASSWORD_HASH=8f3a...:c91d...
#   ADMIN_EMAIL=owner@example.com
```

Then restart. Until you do, a red banner sits across the top of every admin screen.

`SESSION_SECRET` is already set in `.env` (48 random bytes). **Do not remove it** —
without it `lib/auth.ts` falls back to a hard-coded string that is public in the source,
and anyone could forge an admin cookie without knowing the password.
`npm run verify:auth` proves the boundary holds.

## What the owner can do

| | |
|---|---|
| **Add a product** | Products → *Add product*. Title and product code are required (the code is what customers quote on the phone). |
| **Upload a photo** | In the editor → *Upload photo*. JPG/PNG/WebP/AVIF/GIF, max 8MB. Or paste an image URL. |
| **Change a price** | Editor → Price. Leave blank and the site shows **“Call for price”**. Set *Was* and the “Save £X” badge is calculated automatically. |
| **Update stock** | The dropdown in the table — one click, no dialog. It's the most common daily job. |
| **Hide without deleting** | *Show on website* — stays in the admin, vanishes from the shop. |
| **Feature on the homepage** | *Featured* checkbox. |
| **Delete** | Bin icon. Asks first; removes it from the site immediately. |
| **Find anything** | The search box queries all 1,577 products **server-side**, not just the page you're on. |
| **Spreadsheet round-trip** | *Export CSV* → edit prices/stock in Excel → *Import CSV*. Import always shows a **preview diff first** (rows to update / add, per-field before→after, row-level errors) and writes nothing until you confirm. Rows are matched by `slug`; a bare `productCode` is only accepted when unambiguous (198 Bosch/Neff twin codes exist). Invalid rows block the apply. |
| **Categories / Brands / Business / Enquiries** | Their own tabs. |

Edits are also re-indexed into the RAG store, so the chatbot quotes the new price too.

## The dashboard (analytics)

`/admin` opens on a live dashboard fed by the site's own **first-party analytics**:

- **Call clicks** — every press of a "Call" button, site-wide, with the page/product it
  happened on (`components/CallTracker.tsx`, one delegated listener + `sendBeacon`).
- **Postcode checks** — every postcode entered in the "Do we deliver to you?" prompt.
- Panels: 7-day stat cards with sparklines and week-on-week deltas · calls-per-day bar
  chart (14 days) · **most called-about products** · **where customers are** (postcode
  areas + % local) · latest enquiries · catalogue health · audit trail.

Privacy by design: events store **no cookies, no IP addresses, no identifiers** — just
the event, the page, and (for postcode checks) the postcode. That keeps the demand data
useful without a consent-banner obligation. `npm run verify:analytics` proves the loop:
fires events → asserts the dashboard shows them → cleans up.

## Auth roadmap

Password login is the **demo-phase** gate. Once the client signs off the design, replace
it with Microsoft (Entra ID) or Google SSO — the swap is contained: `checkCredentials()`
in `lib/auth.ts` plus the login route; the session-cookie machinery stays.

## Two behaviours worth knowing

**Edits are locked against re-imports.** When the owner edits a field it's recorded in
`adminOverrideFields`, and a later `npm run db:import` skips locked fields — re-importing
the catalogue can never silently undo the owner's price. Products the owner *creates* are
fully locked.

**Everything is audited.** Every create/update/delete writes an `AdminAuditLog` row with
before/after values and who made the change.

## How the data flows

```
data/products.json ──(npm run db:import)──> SQLite (prisma/dev.db) ──> storefront + admin
                                                     │
                                                     └──> RAG index ──> chatbot
```

`lib/repo.ts` prefers the database and falls back to the bundled JSON if it's unreachable
— the shop stays up, but **admin edits won't show** while it's down (the Products screen
says so in an amber banner). Set the DB up with:

```bash
npx prisma migrate dev      # creates prisma/dev.db
npm run db:import           # loads all 1,577 products
```

> The DB probe is shared between concurrent requests on purpose. An earlier version
> returned "no database" to any request that raced the probe, silently serving the stale
> JSON catalogue at startup. `scripts/catalog/verify-coldstart.mjs` fires 25 simultaneous
> requests at a cold server to keep that fixed.

## Verifying it

```bash
npm run verify:auth    # every admin page/API refuses anonymous access; forged cookies rejected
npm run verify:admin   # login -> add -> appears on site -> edit price/stock -> updates -> delete -> 404
npm run verify:site    # 180 storefront routes
npm run verify:all
```

`verify:admin` creates a throwaway `AUDIT-xxxxx` product and removes it. If a run is
interrupted, `node scripts/catalog/cleanup-audit.mjs` clears leftovers.

## Deliberate design decisions (not gaps)

- **Enquiries cannot be deleted** — they're business records; the lifecycle is
  `new → contacted → closed`, plus CSV export.
- **Single owner account** — one shop, one owner. Multi-user roles arrive with the SSO
  switch (see Auth roadmap); the audit trail already records *who* for that future.
- **SQLite + local-disk uploads** — right-sized for one shop on one machine. The
  deploy-time upgrades are mechanical: `schema.prisma` provider → `postgresql`, and
  `app/api/admin/upload/route.ts` → object storage (S3/Supabase/Vercel Blob).

## Production notes

- **Image uploads** land in `public/uploads/` on local disk — fine on a VM or dedicated
  host; on serverless (Vercel) the disk is ephemeral, so switch
  `app/api/admin/upload/route.ts` to object storage (S3 / Supabase / Vercel Blob).
  Uploads are validated by **magic bytes** — not the filename or the content-type header —
  and saved under a generated UUID, so a filename can never traverse out of the directory.
- **Enquiries** fall back to `data/enquiries.jsonl` when there's no DB; with the DB up they
  go to the `Enquiry` table and appear in the Enquiries tab.
- **SQLite** is fine for one shop. For multiple concurrent writers switch
  `datasource db { provider }` to `postgresql` and set `DATABASE_URL`.
