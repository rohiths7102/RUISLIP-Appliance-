"use client";
import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";

/** Scroll-reveal leaf: children rise in once, at 15% visibility. Reduced-motion renders visible immediately. */
export default function Reveal({ as: Tag = "div", delay = 0, className = "", children }: {
  as?: ElementType; delay?: number; className?: string; children?: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  const [instant, setInstant] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setInstant(true); setShown(true); return; }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} style={instant || !delay ? undefined : { transitionDelay: `${delay}ms` }}
      className={`${instant ? "" : "transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] "}${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"} ${className}`.trim()}>
      {children}
    </Tag>
  );
}
