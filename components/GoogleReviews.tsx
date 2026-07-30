import raw from "@/data/reviews.json";

/** Shape of data/reviews.json — the owner fills these from their real Google
 *  Business Profile (see README-REVIEWS.md). Values are never invented here. */
export type ReviewsData = {
  rating: number | null;
  count: number;
  url: string;
  quotes: { name: string; stars: number; text: string }[];
};

// Cast once: the empty seed file type-narrows too aggressively (rating: null,
// quotes: never[]) and would break the populated render paths.
const reviews = raw as ReviewsData;

/** Five-star row — fill follows the value, so the display can't over-claim. */
function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5 text-warning" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
          fill={i <= Math.round(value) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6"
        >
          <path d="M12 2.6l2.94 5.95 6.57.96-4.75 4.63 1.12 6.54L12 17.6l-5.88 3.08 1.12-6.54-4.75-4.63 6.57-.96L12 2.6z" />
        </svg>
      ))}
    </span>
  );
}

/**
 * Google reviews band. INTEGRITY GATE: renders nothing at all until real
 * figures exist in data/reviews.json — placeholder or invented reviews would
 * breach CMA guidance on fake endorsements, so the empty state is invisible.
 */
export default function GoogleReviews() {
  if (reviews.rating === null || reviews.quotes.length === 0) return null;
  return (
    <section aria-labelledby="reviews-heading" className="border-y border-line bg-card">
      <div className="container-x py-14 md:py-16">
        {/* Headline row: big display numeral, quiet supporting copy */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Stars value={reviews.rating} size={18} />
          <h2 id="reviews-heading" className="flex items-baseline gap-2">
            <span className="font-display text-4xl leading-none text-ink">{reviews.rating.toFixed(1)}</span>
            <span className="text-[14px] text-muted">from {reviews.count} Google reviews</span>
          </h2>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {reviews.quotes.slice(0, 3).map((q) => (
            <figure key={q.name} className="rounded-xl border border-line bg-paper p-5">
              <Stars value={q.stars} size={13} />
              <blockquote className="mt-3 text-[14px] leading-relaxed text-ink">&ldquo;{q.text}&rdquo;</blockquote>
              <figcaption className="mt-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                {q.name}
              </figcaption>
            </figure>
          ))}
        </div>

        {reviews.url && (
          <a
            href={reviews.url} target="_blank" rel="noopener noreferrer"
            className="mt-7 inline-block text-[13.5px] font-semibold text-blue transition-colors duration-200 hover:text-blue-deep"
          >
            Read them all on Google &rarr;
          </a>
        )}
      </div>
    </section>
  );
}
