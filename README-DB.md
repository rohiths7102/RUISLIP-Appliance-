# Slice 3 — Database layer (Prisma)

Adds the data layer the whole app hangs off: `prisma/schema.prisma` (8 models),
`lib/db.ts` (Prisma client singleton), `prisma/seed.ts` (loads `data/*.json`),
and `npm` scripts. Local dev uses **SQLite**; production switches to **Postgres**
by changing one line + `DATABASE_URL`.

## Models
Product, Category (self-relation tree), Brand, BusinessInfo (singleton),
ServiceAddOn, AdminAuditLog, ScrapeJob, RAGDocument. List/nested fields are
stored as JSON so the identical schema runs on SQLite and Postgres.

## Run locally
```bash
npm install
npx prisma migrate dev --name init   # creates dev.db + migration
npm run db:seed                       # loads 35 products, 25 categories, 19 brands, business, services
npm run db:studio                     # browse the data
```

## Production (Postgres)
1. In `prisma/schema.prisma` set `datasource.provider = "postgresql"`.
2. Set `DATABASE_URL` to your Postgres connection string.
3. `npx prisma migrate deploy && npm run db:seed`.
4. (Optional) convert JSON list fields to native arrays and `RAGDocument.embedding` to `pgvector`.

## Verification note
This sandbox blocks Prisma's engine download host (`binaries.prisma.sh`, 403), so
`prisma migrate` can't run here. The schema + seed were instead verified by
building the identical tables directly in SQLite and loading the data:
35 products / 25 categories / 19 brands, foreign-key links intact, `UNIQUE(slug)`
enforced. On your machine (open network) `prisma migrate dev` works normally; if
your network also blocks that host, allowlist `binaries.prisma.sh`.

Data is still the 35-product seed — Slice 5 swaps in the full scraped catalogue.
