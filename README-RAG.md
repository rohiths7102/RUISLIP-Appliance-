# Slice 8 — RAG pipeline

Turns the catalogue + store info into retrievable, grounded documents for the
chatbot (Slice 9). Keyless by default; optional vector embeddings.

## What's indexed
Products (title, code, brand, category, price, warranty, specs), categories,
brands, services, business contact/hours/delivery, and grounded FAQs
(how-to-buy = phone-first, payment, installation, availability).

## Retrieval
- **Default: lexical BM25** with prefix matching (no API key, deterministic, fast).
  Strong for product queries and codes — e.g. `WAN28258GB` returns that product first.
- **Optional: semantic** — set `EMBEDDINGS_API_KEY` (+ optional `EMBEDDINGS_URL`,
  `EMBEDDINGS_MODEL`, OpenAI-compatible) to store vectors and rank by cosine
  similarity. (Groq itself has no embeddings endpoint, so this is a separate,
  optional provider.)

## Commands
```bash
npm run rag:build     # build RAGDocument rows from the DB (embeds if configured)
npm run rag:test      # sample-query self-test (works on seed even without a DB)
npm run rag:sync <productId>   # reindex one product (used by admin edits, Slice 10)
```

## Resilience
`searchIndex()` uses the DB index when present, and otherwise builds documents
from the seed in memory — so the chatbot always has grounding, even before
`rag:build` is run.

Verified: 5/5 retrieval cases (exact code, brand+type, opening hours, delivery,
payment) return the correct documents.
