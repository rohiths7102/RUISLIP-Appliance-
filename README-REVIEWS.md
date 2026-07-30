# Adding your real Google reviews

The reviews band on the site stays **completely hidden** until you fill in `data/reviews.json` with real figures — nothing is ever made up.

1. Open [business.google.com](https://business.google.com) (or search your shop name on Google) — your **star rating** and **review count** are shown at the top of your profile / knowledge panel.
2. In Google Business Profile, tap **Ask for reviews** to get your short review link (looks like `g.page/r/...`) — use that as `url`.
3. Pick 2–3 genuine reviews and copy them **word for word** into `quotes`, like this:

```json
{ "rating": 4.9, "count": 120, "url": "https://g.page/r/XXXX/review",
  "quotes": [ { "name": "Jane D.", "stars": 5, "text": "Fitted our washer next day — brilliant service." } ] }
```

**Important:** only ever paste reviews real customers actually wrote. Inventing or editing reviews is illegal under UK consumer law (CMA guidance on fake reviews) — when in doubt, leave the file empty and the site simply shows nothing.
