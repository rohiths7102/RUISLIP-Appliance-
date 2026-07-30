"use client";
import { useEffect, useState } from "react";
import type { Business } from "@/lib/types";

// Fallback when no business record is passed: Mon–Sat 09:00–17:30, Sunday closed.
const DEFAULT_HOURS: Record<string, string> = {
  monday: "09:00 - 17:30", tuesday: "09:00 - 17:30", wednesday: "09:00 - 17:30",
  thursday: "09:00 - 17:30", friday: "09:00 - 17:30", saturday: "09:00 - 17:30", sunday: "Closed",
};

/** "17:30" -> "5:30pm", "09:00" -> "9am" — reads like a person, not a timetable. */
const pretty = (h: number, m: number) => {
  const h12 = h % 12 || 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

const parse = (s: string | undefined) => {
  const m = s?.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  return m ? { oh: +m[1], om: +m[2], ch: +m[3], cm: +m[4] } : null; // null = closed all day
};

function status(hours: Record<string, string>) {
  // Shop time is Europe/London regardless of the visitor's device timezone.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "long", hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const day = get("weekday").toLowerCase();
  const now = (+get("hour") % 24) * 60 + +get("minute"); // %24: some engines emit "24:xx"
  const today = parse(hours[day]);
  if (today && now >= today.oh * 60 + today.om && now < today.ch * 60 + today.cm) {
    return { open: true, label: `Open now · until ${pretty(today.ch, today.cm)}` };
  }
  // Closed: quote the usual opening time (first open day found) rather than guessing tomorrow.
  const first = Object.values(hours).map(parse).find(Boolean);
  return { open: false, label: `Closed · opens ${first ? pretty(first.oh, first.om) : "9am"} Mon–Sat` };
}

/** Small live dot + label. Hydration-safe: nothing renders until we're on the client clock. */
export default function OpenNow({ business, tone = "light", className = "" }: {
  business?: Business;
  /** "dark" = sitting on navy (header); "light" = paper pages (contact). */
  tone?: "light" | "dark";
  className?: string;
}) {
  const [state, setState] = useState<null | { open: boolean; label: string }>(null);
  useEffect(() => {
    const hours = business?.openingHours && Object.keys(business.openingHours).length ? business.openingHours : DEFAULT_HOURS;
    const tick = () => setState(status(hours));
    tick();
    const t = setInterval(tick, 60_000); // stays honest if the tab is left open past 5:30
    return () => clearInterval(t);
  }, [business]);

  if (!state) return null;
  const colours = state.open
    ? tone === "dark" ? "text-success-soft" : "text-success"
    : tone === "dark" ? "text-paper/45" : "text-muted";
  const dot = state.open
    ? tone === "dark" ? "bg-success-soft" : "bg-success"
    : tone === "dark" ? "bg-paper/30" : "bg-muted/50";
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] ${colours} ${className}`}>
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {state.label}
    </span>
  );
}
