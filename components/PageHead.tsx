import { telHref, STORE_PHONE } from "@/lib/format";

/** The dark navy band that opens every inner page. */
export default function PageHead({
  eyebrow,
  title,
  intro,
  showPhone = true,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  showPhone?: boolean;
}) {
  return (
    <section className="bg-navy px-6 py-14">
      <div className="container-x">
        <p className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.24em] text-sky">— {eyebrow}</p>
        <h1 className="mb-2.5 font-display text-[clamp(32px,5vw,48px)] font-normal leading-[1.05] text-paper">{title}</h1>
        {intro && (
          <p className="max-w-[620px] text-[15px] leading-relaxed text-[#b6cce4]">
            {intro}
            {showPhone && (
              <>
                {" "}
                <a href={telHref(STORE_PHONE)} className="text-sky underline-offset-4 hover:underline">
                  {STORE_PHONE}
                </a>{" "}
                to confirm live stock and arrange delivery.
              </>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
