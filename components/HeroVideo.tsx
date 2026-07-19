"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Cinematic hero background — a real muted looping video.
 *
 * Picks the 4K file on large screens and the 1080p file on small ones (chosen
 * once on mount; a hero background doesn't need to re-negotiate on resize).
 * Falls back to the 4K poster still with a slow Ken-Burns push when the video
 * can't play (reduced motion, save-data, decode failure), so the section never
 * looks flat. Swap `videoSrc` for a brand film later — nothing else changes.
 */
export default function HeroVideo({
  videoSrc,
  videoSrcSmall,
  poster,
}: {
  videoSrc?: string;
  videoSrcSmall?: string;
  poster: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!videoSrc) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const saveData = (navigator as any).connection?.saveData === true;
    if (reduce || saveData) return;
    const small = window.innerWidth < 1280 && videoSrcSmall;
    setSrc(small ? videoSrcSmall! : videoSrc);
  }, [videoSrc, videoSrcSmall]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !src) return;
    // A rejected play() is NOT a failure: it happens in background tabs and
    // before user interaction. Keep the video mounted and retry on focus —
    // only a real decode/network error (onError) demotes to the poster.
    const tryPlay = () => { const p = v.play?.(); if (p?.catch) p.catch(() => {}); };
    tryPlay();
    const onVisible = () => { if (!document.hidden) tryPlay(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [src]);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-navy-3">
      {src && !failed ? (
        <video
          ref={ref}
          className="h-full w-full object-cover"
          autoPlay muted loop playsInline preload="auto"
          poster={poster}
          onError={() => setFailed(true)}
          aria-hidden
        >
          <source src={src} type="video/mp4" />
        </video>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={poster} alt="" aria-hidden className="hero-ken h-full w-full object-cover" />
      )}
    </div>
  );
}
