"use client";
import { useState } from "react";
import { Rotate3d } from "lucide-react";

/**
 * The real shop, walkable — Matterport 3D tour of the Ruislip showroom.
 * Facade pattern: the heavy viewer iframe only loads after a deliberate click,
 * so the tour never costs a byte on first paint. This is the "proof over
 * claims" asset — an actual walk around the actual shop.
 */
const TOUR_URL = "https://mpembed.com/show/?m=TeyASf1Th7K&mpu=1832";

export default function ShowroomTour({ className = "" }: { className?: string }) {
  const [live, setLive] = useState(false);
  return (
    <div className={`relative aspect-video overflow-hidden rounded-[4px] border border-ink/10 bg-navy ${className}`}>
      {live ? (
        <iframe
          src={TOUR_URL}
          title="3D tour of the Euronics Ruislip showroom"
          className="absolute inset-0 h-full w-full"
          allow="xr-spatial-tracking; fullscreen"
          allowFullScreen
          loading="lazy"
        />
      ) : (
        <button
          type="button"
          onClick={() => setLive(true)}
          className="group absolute inset-0 flex flex-col items-center justify-center gap-4 text-paper"
          aria-label="Load the interactive 3D tour of our showroom"
        >
          <span className="absolute inset-0 bg-[radial-gradient(80%_80%_at_50%_20%,rgba(63,157,240,.18),transparent_60%)]" />
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-blue transition-transform duration-500 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] group-hover:scale-110">
            <Rotate3d size={26} className="text-navy" />
          </span>
          <span className="relative font-display text-2xl">Walk around our showroom</span>
          <span className="relative font-mono text-[10px] uppercase tracking-[0.2em] text-sky">
            Interactive 3D tour · loads on tap
          </span>
        </button>
      )}
    </div>
  );
}
