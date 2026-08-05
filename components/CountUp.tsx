"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Stat that counts up when scrolled into view — ease-out cubic over ~1.2s.
 * Server (and reduced motion, and no-JS) renders the final number, so SEO and
 * accessibility always see the real figure; the 0-start only happens client-side
 * once the band is about to animate.
 */
export default function CountUp({ to, duration = 1200, className = "" }: {
  to: number; duration?: number; className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(to);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        setValue(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [to, duration]);

  return <span ref={ref} className={className}>{value.toLocaleString("en-GB")}</span>;
}
