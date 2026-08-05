"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Premium rotating word for the hero H1 — a vertical roll through the shop's
 * real departments, with the container's width gliding to fit each word.
 * Accessibility/SEO: assistive tech and crawlers read a static `fallback`
 * ("appliances"); the animation is aria-hidden. Reduced motion renders the
 * fallback outright.
 */
export default function RotatingWord({
  words,
  fallback,
  intervalMs = 2600,
  className = "",
}: {
  words: string[];
  fallback: string;
  intervalMs?: number;
  className?: string;
}) {
  const [i, setI] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [width, setWidth] = useState<number | null>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setReduced(true); return; }
    const t = setInterval(() => setI((x) => (x + 1) % words.length), intervalMs);
    return () => clearInterval(t);
  }, [words.length, intervalMs]);

  // Width follows the active word; re-measured when the display font lands and on resize.
  useLayoutEffect(() => {
    const measure = () => { const el = wordRefs.current[i]; if (el) setWidth(el.offsetWidth); };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [i]);

  if (reduced) return <span className={className}>{fallback}</span>;

  return (
    <>
      <span className="sr-only">{fallback}</span>
      <span
        aria-hidden
        className={`relative inline-block overflow-hidden align-bottom transition-[width] duration-500 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] ${className}`}
        style={{ height: "1.12em", width: width === null ? undefined : `${width}px` }}
      >
        {words.map((w, x) => {
          const prev = (i + words.length - 1) % words.length;
          const pos = x === i ? "translate-y-0 opacity-100" : x === prev ? "-translate-y-[80%] opacity-0" : "translate-y-[80%] opacity-0";
          return (
            <span
              key={w}
              ref={(el) => { wordRefs.current[x] = el; }}
              className={`absolute left-0 top-0 whitespace-nowrap transition-[transform,opacity] duration-500 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] ${pos}`}
            >
              {w}
            </span>
          );
        })}
      </span>
    </>
  );
}
