# Slice 9 — Groq chatbot

A grounded, phone-first assistant. Backend `/api/chat` retrieves store context
(Slice 8 RAG) and calls Groq with a strict system prompt; the premium widget
(bottom-right on every page) is the only thing the browser talks to.

## Security
- The Groq key lives ONLY in `.env` as `GROQ_API_KEY` and is used server-side.
  Verified: it does **not** appear in the client bundle (`.next/static`).
- `.env` is gitignored. **This build ships a working `.env` for local dev at your
  request — ROTATE/REVOKE that key in the Groq console before you deploy**, since
  a shared key should be treated as compromised.

## Config (.env)
```
GROQ_API_KEY=...            # server-only
GROQ_MODEL=llama-3.3-70b-versatile
# optional semantic embeddings (Groq has none): EMBEDDINGS_API_KEY=...
```

## Behaviour (enforced by the system prompt)
- Never claims an item is definitely in stock — always "call 0208 864 5763 to confirm".
- Prices are a guide that may need confirming; never invents prices/warranty/fees.
- Payment/delivery/fitting arranged with the store; outside the local area → call.
- Cites product codes and links from the retrieved context.
- Graceful fallbacks: if Groq is unset or errors, it points the customer to the phone.
- 20s timeout + simple per-IP rate limit (use Redis for multi-instance prod).

## Run
```bash
npm install
npx prisma migrate dev --name init && npm run db:seed   # or db:import for full catalogue
npm run rag:build        # optional — chat also works on the seed index
npm run dev              # widget appears bottom-right; admin test at /admin/chatbot
```

Note: the live LLM call was not exercised in the build sandbox (no outbound
network to Groq there). Verified here: grounded prompt + retrieval + sources,
no key leak, and a clean production build. Run locally to see live replies.
