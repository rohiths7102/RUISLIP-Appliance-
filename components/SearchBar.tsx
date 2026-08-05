"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

/**
 * Header search — the owner asked for the official Euronics site's format
 * ("my name and search bar and same colours"). Routes to /products?q=…, which
 * server-renders the browser with the query pre-filled (the same entry point
 * the sitelinks SearchAction schema advertises to Google).
 */
export default function SearchBar({ className = "" }: { className?: string }) {
  const [v, setV] = useState("");
  const router = useRouter();
  return (
    <form
      role="search"
      className={`flex items-center overflow-hidden rounded-full border border-ink/15 bg-white focus-within:border-blue ${className}`}
      onSubmit={(e) => { e.preventDefault(); const q = v.trim(); if (q) router.push(`/products?q=${encodeURIComponent(q)}`); }}
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Search 1,800+ appliances…"
        aria-label="Search products"
        className="min-w-0 flex-1 bg-transparent px-4 py-2 text-sm text-ink placeholder:text-muted outline-none"
      />
      <button type="submit" aria-label="Search" className="m-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-paper transition-colors hover:bg-blue">
        <Search size={15} strokeWidth={2.4} />
      </button>
    </form>
  );
}
