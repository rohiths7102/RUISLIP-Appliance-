import { warrantyYears } from "@/lib/warranty";

/**
 * The cover, on the shot itself — the Save flash holds the top-left corner and
 * the energy arrow the bottom-left, so this takes the top-right.
 *
 * Renders nothing when the record carries no cover: a warranty badge is a
 * promise the shop has to honour, so it is only ever drawn from real data.
 */
export default function WarrantyBadge({ warranty }: { warranty: string }) {
  const text = warranty.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const years = warrantyYears(text);
  return (
    <span
      title={text}
      aria-label={text}
      className="absolute right-3 top-3 z-10 max-w-[106px] bg-blue-deep px-2 py-1.5 text-center text-white shadow-[0_1px_3px_rgba(8,21,56,0.28)] ring-1 ring-white/35"
    >
      {years !== null ? (
        <>
          <span className="block text-[17px] font-bold leading-none tabular-nums">{years}</span>
          <span className="block text-[7.5px] font-bold uppercase leading-[1.25] tracking-[0.1em]">
            year
            <br />
            warranty
          </span>
        </>
      ) : (
        /* Cover the plain "N Year Warranty" form cannot express — parts-and-labour
           splits and the like. Kept in the shop's own words rather than reduced
           to a number that would misstate it. */
        <span className="line-clamp-3 block text-[8.5px] font-bold uppercase leading-[1.3] tracking-[0.06em]">
          {text}
        </span>
      )}
    </span>
  );
}
