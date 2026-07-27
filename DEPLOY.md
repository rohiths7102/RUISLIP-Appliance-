# Go-live runbook

One page, start to finish. Follow it top to bottom — nothing here needs a developer,
just careful copy-and-paste. Where a value is secret it goes in an **env var**, never in code.

## 0) What we're deploying

The Next.js app runs on **Vercel** (it builds and hosts the site), the catalogue and
enquiries live in **Supabase Postgres**, and product photos live in **Vercel Blob**
storage. The client's domain and email **stay exactly where they are at LCN** — we only
change where the domain *points* (step 5), and only when everyone is happy with the
preview. Until then the shop's current site and email are untouched.

## 1) One-time local prep (your machine)

1. Copy `.env.example` to `.env.local` and fill in at least:
   - `BLOB_READ_WRITE_TOKEN` — in Vercel: **Storage → your Blob store → `.env.local` tab**, copy the token.
   - `SUPABASE_DB_URL` — in Supabase: **Project → Connect**, copy the **Transaction pooler** URI (it contains `pooler.supabase.com:6543`) and put your database password in it.
2. Push the schema and seed the full catalogue into Supabase:
   ```bash
   npm run pg:deploy
   ```
3. Upload every catalogue image to Vercel Blob (add `--dry-run` first if you want a preview via `npm run blob:sync:dry`):
   ```bash
   npm run blob:sync
   ```

Both commands are safe to re-run; they only add what's missing.

## 2) Push to GitHub

Create a **private** repository and push this project to it. `.gitignore` already keeps
`.env*` files out — never commit them.

## 3) Import into Vercel

In Vercel: **Add New → Project → import the GitHub repo**. The framework (Next.js) is
auto-detected — leave build settings alone, including **Root Directory**: the app sits at
the repo root (`app/`, `lib/`, `prisma/` are top-level), so it must stay the default.
Before pressing **Deploy**, add these environment variables (Settings → Environment
Variables, apply to all environments):

| Variable | Value |
|---|---|
| `DATABASE_URL` | The Supabase **Transaction pooler** URI — the same value you used as `SUPABASE_DB_URL` in step 1. |
| `BLOB_READ_WRITE_TOKEN` | Same token as step 1 (added automatically if you create the Blob store from this project). |
| `GROQ_API_KEY` | Your Groq key (powers the chatbot). |
| `SESSION_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ADMIN_EMAIL` | The owner's sign-in email. |
| `ADMIN_PASSWORD_HASH` | Generate: `node scripts/hash-password.mjs "a-strong-password"` — paste the printed hash. |
| `NEXT_PUBLIC_SITE_URL` | The `*.vercel.app` URL for now; swap to the real domain at go-live (step 5). |

Optional (add when needed):

| Variable | Value |
|---|---|
| `ADMIN_PATH` | Secret admin URL segment, e.g. `manage-8f3a2` (see SECURITY.md — obscurity, not security). |
| `ADMIN_ALLOWED_IPS` | Comma-separated IPs allowed to reach the admin; everyone else gets 404. |
| `NEXT_PUBLIC_GA_ID` | Google Analytics ID, if the client wants GA on top of the built-in analytics. |
| `RESEND_API_KEY` | Resend key — turns on email notifications for new enquiries. |
| `ENQUIRY_NOTIFY_TO` | Where enquiry notifications are sent (the shop's inbox). |
| `ENQUIRY_FROM_EMAIL` | The "from" address on those notifications (a domain verified in Resend). |

Press **Deploy** and wait for the green tick.

## 4) After the first deploy

Share the `https://<project>.vercel.app` link with the client — it's the live preview.
Then verify, in order:

- [ ] Home page loads with images.
- [ ] Open any product page — photo, price and "Call" button all present.
- [ ] Admin sign-in works at `/admin` (or your `ADMIN_PATH`).
- [ ] Add a test product — it appears on the storefront.
- [ ] Upload a photo on that product — it displays (proves Blob is wired).
- [ ] Submit an enquiry via the contact form — it appears in the admin Enquiries tab.
- [ ] Delete the test product.

## 5) LATER — go-live on the real domain

Only when the client signs off the preview:

1. In Vercel: **Settings → Domains → add the domain**. Vercel shows the DNS records it wants.
2. In the LCN control panel, change **only** the A record (root domain) and the CNAME (`www`) to the values Vercel shows. **Do not touch the MX rows** — email stays on LCN and keeps working.
3. Set `NEXT_PUBLIC_SITE_URL` in Vercel to `https://www.<the-domain>` and redeploy.
4. Claim the free Google surfaces:
   - **Google Business Profile** — the shop's map listing and phone number.
   - **Search Console** — verify the domain, submit `/sitemap.xml`.
   - **Merchant Center** — free product listings; the feed URL is `https://www.<the-domain>/merchant-feed.xml`.

DNS changes take minutes to a few hours. The old host can be switched off afterwards.

## 6) If something breaks

| Symptom | Likely cause and fix |
|---|---|
| Products missing / "no database" banner in admin | `DATABASE_URL` is the wrong form. It must be the Supabase **Transaction pooler** URI (`...pooler.supabase.com:6543/postgres`), not the direct connection string, and the password must be filled in. Fix the var in Vercel, redeploy. |
| Admin sign-in loops or sessions don't stick | `SESSION_SECRET` is missing or was changed between deploys. Set it once (step 3), redeploy, sign in again. Never leave it empty — cookies would be forgeable. |
| Product images 404 on the live site | `npm run blob:sync` was never run (or `BLOB_READ_WRITE_TOKEN` was missing when it ran). Run it locally with the token in `.env.local` — it's safe to re-run and only uploads what's missing. |

Still stuck? Vercel → the deployment → **Logs** shows the real error message.
