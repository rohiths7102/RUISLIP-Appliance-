/** Instant feedback for the click. A cold product page could take 3–6s to
 *  render server-side, during which the customer saw NOTHING happen and
 *  reported the pages as broken. The skeleton paints immediately. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-4 py-10">
      <div className="h-4 w-48 rounded bg-neutral-200" />
      <div className="mt-6 grid gap-10 md:grid-cols-2">
        <div className="aspect-square rounded-xl bg-neutral-200" />
        <div>
          <div className="h-7 w-3/4 rounded bg-neutral-200" />
          <div className="mt-3 h-4 w-1/3 rounded bg-neutral-200" />
          <div className="mt-8 h-9 w-40 rounded bg-neutral-200" />
          <div className="mt-6 space-y-2">
            <div className="h-3 w-full rounded bg-neutral-200" />
            <div className="h-3 w-5/6 rounded bg-neutral-200" />
            <div className="h-3 w-2/3 rounded bg-neutral-200" />
          </div>
        </div>
      </div>
    </div>
  );
}
