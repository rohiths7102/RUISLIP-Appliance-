"use client";
import { useState } from "react";
import Image from "next/image";

/** Product shots sit on a white tile; multiply blends the box background out. */
export default function ProductGallery({
  images,
  title,
  code,
  fallback,
}: {
  images: string[];
  title: string;
  code: string;
  fallback: string;
}) {
  const [active, setActive] = useState(0);
  // Visited shots stay mounted and crossfade on toggle — no white flash on
  // thumbnail clicks; unvisited ones aren't fetched until first viewed.
  const [visited, setVisited] = useState([0]);
  const shots = images.length ? images.slice(0, 8) : [];

  return (
    <div className="lg:sticky lg:top-[96px]">
      <div className="relative aspect-square overflow-hidden rounded-[4px] border border-ink/10 bg-gradient-to-br from-white to-paper-2">
        {shots.length ? (
          shots.map((src, i) =>
            visited.includes(i) ? (
              // The paper gradient behind shows until onLoad flips data-loaded → fade in.
              <Image key={i} src={src} alt={title} fill priority={i === 0}
                sizes="(max-width: 1024px) 100vw, 560px"
                onLoad={(e) => { e.currentTarget.dataset.loaded = "true"; }}
                className={`shot object-contain p-14 opacity-0 transition-opacity duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${
                  i === active ? "data-[loaded]:opacity-100" : ""
                }`} />
            ) : null
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-navy-2 to-navy">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-sky">{fallback}</span>
          </div>
        )}
      </div>

      {/* Code chip sits below the photo, not on it — keeps the shot clean. */}
      <div className="mt-3 inline-flex rounded-sm bg-navy px-3 py-1.5">
        <span className="font-mono text-[10px] tracking-[0.1em] text-sky">{code}</span>
      </div>

      {shots.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2.5">
          {shots.map((g, i) => (
            <button
              key={i}
              onClick={() => { setActive(i); setVisited((v) => (v.includes(i) ? v : [...v, i])); }}
              aria-label={`View image ${i + 1} of ${title}`}
              aria-current={i === active}
              className={`h-[74px] w-[74px] overflow-hidden rounded-[3px] bg-white p-1 transition-colors ${
                i === active ? "border-2 border-blue" : "border border-ink/10 hover:border-blue/50"
              }`}
            >
              <span className="relative block h-full w-full">
                <Image src={g} alt="" fill sizes="74px"
                  onLoad={(e) => { e.currentTarget.dataset.loaded = "true"; }}
                  className="shot object-contain opacity-0 transition-opacity duration-500 ease-[cubic-bezier(.2,.8,.2,1)] data-[loaded]:opacity-100" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
