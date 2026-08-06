"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

/** Read-only value with a one-tap copy — for feed URLs and the like. */
export default function CopyField({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      {label && <p className="mb-1.5 text-xs font-semibold text-muted">{label}</p>}
      <div className="flex items-center gap-2 overflow-hidden rounded-xl border border-line bg-paper-2/70 pl-3.5">
        <code className="min-w-0 flex-1 truncate py-2.5 font-mono text-[12px] text-ink">{value}</code>
        <button
          type="button"
          onClick={async () => {
            try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1600); } catch {}
          }}
          className={`flex shrink-0 items-center gap-1.5 self-stretch px-3.5 text-[12px] font-semibold transition-colors ${done ? "bg-success-soft text-success" : "bg-navy text-white hover:bg-navy-2"}`}
        >
          {done ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
        </button>
      </div>
    </div>
  );
}
