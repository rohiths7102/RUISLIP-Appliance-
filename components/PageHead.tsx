import { telHref, waHref, STORE_PHONE } from "@/lib/format";
import WhatsAppIcon from "@/components/WhatsAppIcon";
import { Phone } from "lucide-react";

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
        <h1 className="mb-2.5 font-display text-display-1 font-normal leading-[1.05] text-paper text-balance">{title}</h1>
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
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={telHref(STORE_PHONE)}
            className="inline-flex items-center gap-2.5 rounded-sm bg-cta px-6 py-3.5 text-[14.5px] font-bold text-white transition-colors hover:bg-cta-deep">
            <Phone size={16} strokeWidth={2.2} /> {STORE_PHONE}
          </a>
          <a href={waHref()} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2.5 rounded-sm bg-[#25D366] px-6 py-3.5 text-[14.5px] font-bold text-white transition-colors hover:bg-[#1da851]">
            <WhatsAppIcon size={17} /> WhatsApp us
          </a>
        </div>
      </div>
    </section>
  );
}
