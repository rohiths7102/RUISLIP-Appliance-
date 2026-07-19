# Run the site locally on port 3005

## Fastest (dev preview)
Double-click **run.bat** (Windows), or in a terminal in this folder:
```
npm install
npm run dev
```
Then open **http://localhost:3005**. Works immediately on the seed data — no
database or API key required (it falls back to the bundled data).

## Production mode
```
npm install
npm run build
npm start        # serves http://localhost:3005
```

## Full data + chatbot (optional)
```
npx prisma migrate dev --name init && npm run db:seed   # or npm run db:import after npm run scrape
npm run rag:build
```
The Groq chatbot uses the key in `.env`. ROTATE that key before deploying.

## Change the port
Edit `package.json` -> scripts -> `dev` / `start` and replace `3005`.
Requires Node.js 18.18+ (20+ recommended): https://nodejs.org
