# Marketing engine

One loop, from being seen on Google to a sale, run from the admin. Every
number comes from a named source; every change to the Google Ads account is
either pressed by a person or made by an opt-in rule, and is written to the
audit log either way.

```
 Google Ads API ─┐                         ┌─ Admin → Today      (what to do next)
 Search Console ─┤                         ├─ Admin → Telemetry  (Google → visit → call → sale)
 site events ────┼─► lib/marketing/*  ─────┼─ Admin → Google Ads / SEO
 enquiries ──────┤                         ├─ daily job 06:00 UTC (/api/cron/daily)
 catalogue/prices┘                         └─ Monday report (email)
```

## Pieces

| What | Where | Notes |
|---|---|---|
| Delivery towns (one list) | `lib/areas.ts` | Homepage, `/areas/*`, structured data, `llms.txt` all read it. Add a town once. |
| Town pages | `app/areas/[slug]` | HomeGoodsStore + FAQPage + BreadcrumbList JSON-LD; featured products from Admin → Homepage. |
| AI answer engines | `app/llms.txt` | Built from live catalogue, business details and towns. |
| Google Ads reports | `lib/ads-reports.ts` | Same GAQL for the Ads Script and the API. Includes the account's negatives, so nothing already blocked is offered again. |
| Direct connection | `lib/google-oauth.ts`, `lib/google-ads-api.ts` | One Google sign-in for Ads + Search Console; refresh token AES-GCM encrypted. No developer token needed since 9 Sept 2026. |
| Actions (Today) | `lib/marketing/engine.ts` | Rules in `RULES`; each action states the rule and numbers that raised it. Dismiss = hide 30 days. |
| Automation | `lib/marketing/automation.ts` | Off by default. Blocks a search only if ≥ £min spend, ≥ 3 clicks, 0 conversions, not a brand search, not already negated. Max N a night. |
| Daily job | `app/api/cron/daily`, `vercel.json` | Sync → auto-block (if on) → Monday report (if on). One `marketing:daily` audit row per run. |
| Weekly report | `lib/marketing/report.ts` | Outlook (Microsoft 365) if connected, else Resend. |
| Telemetry | `lib/marketing/telemetry.ts` | Anonymous page views (no cookies, no identifiers), channels from referrer, AI-assistant referrals, towns, hours. |
| Dashboard | `app/admin/page.tsx` | Google Ads this week, monthly targets (`TargetsCard`, stored in `marketing.targets`), "In sync?" (`lib/marketing/health.ts`), top to-dos. |
| Sales & Leads | `components/admin/SalesAdmin.tsx` | Channel per lead (`lib/marketing/channels.ts`), waiting time with a 24h overdue flag, reply and win rates, sale-reported badges. |
| SEO editor | `components/admin/SeoEditor.tsx`, `app/api/admin/seo/suggest` | Pages at Search Console position 4–15: edit title/description in place; "Suggest" writes them from that page's real queries. Saves via the product/category admin routes (audited). |
| Activity log | `app/admin/activity` | Every AdminAuditLog row, filter by area, search, before/after. |
| Sales back to Google | `uploadSale` in `lib/google-ads-api.ts` | When an enquiry with a Google Ads click (consented) is set to Won, the sale and its value go to the "Website sale" conversion action (secondary). |

## Environment (Vercel, Production)

| Variable | Needed for |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | the Google sign-in (Ads + Search Console) |
| `ADS_SYNC_SECRET` | the optional Google Ads Script feed |
| `CRON_SECRET` | the daily job (Vercel sends it automatically) |
| `RESEND_API_KEY` or the `MS_*` Microsoft 365 set | emailing the weekly report |
| `GSC_SITE` (optional) | Search Console property. Leave unset: the site uses whichever of the Domain property or the `https://www.` URL-prefix property the connected account can see |

## Controls

- Nothing changes the Ads account unless pressed in the admin or switched on in Today → Automation.
- Every Ads change: audit log (`ads:*`, `marketing:auto-block`, `ads:sale_reported`).
- Brand searches (containing Jyotsna, Ruislip or Euronics) are never auto-blocked.
- "Website sale" starts as a secondary conversion: reported, not bid on. Make it primary once ~15 sales a month are being reported.
- Page views are counted without cookies; the Google Ads click id is only kept when the visitor accepted cookies (read from Google's own `_gcl_aw` cookie).
