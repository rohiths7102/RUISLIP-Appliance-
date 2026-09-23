"use client";
import { useState } from "react";
import { WARRANTY_YEARS, warrantyLabel, normaliseWarranty } from "@/lib/warranty";

/**
 * The warranty template: pick the years and every product reads the same —
 * "5 Year Warranty" — which is also what puts the years badge on the photo.
 * "Other wording" keeps a manufacturer's longer text (e.g. parts-only cover)
 * that a plain number would misstate.
 */
export default function WarrantyPicker({ value, onChange, className = "" }: { value: string; onChange: (v: string) => void; className?: string }) {
  const norm = normaliseWarranty(value);
  const years = WARRANTY_YEARS.find((y) => warrantyLabel(y) === norm);
  const [custom, setCustom] = useState(!!norm && !years);
  const choice = custom ? "custom" : years ? String(years) : "";
  return (
    <div className={className}>
      <select value={choice} aria-label="Warranty"
        onChange={(e) => {
          const v = e.target.value;
          if (v === "custom") { setCustom(true); return; }
          setCustom(false);
          onChange(v ? warrantyLabel(Number(v)) : "");
        }}
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
        <option value="">No warranty shown</option>
        {WARRANTY_YEARS.map((y) => <option key={y} value={y}>{warrantyLabel(y)}</option>)}
        <option value="custom">Other wording…</option>
      </select>
      {custom && (
        <input value={value} onChange={(e) => onChange(e.target.value)} autoFocus
          placeholder="e.g. 1 Year Parts and Labour + 9 Year Parts Guarantee"
          className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm" />
      )}
      <span className="mt-1 block text-[11px] font-normal text-muted">
        {years ? `Shows as “${warrantyLabel(years)}” with a ${years}-year badge on the photo.` : custom ? "Shown exactly as written. A plain number like “3” becomes “3 Year Warranty”." : "No warranty line or badge."}
      </span>
    </div>
  );
}
