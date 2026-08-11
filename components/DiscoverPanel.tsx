"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { BUDGETS } from "@/components/ProductBrowser";

export interface DiscoverDept { name: string; subs: string[] }

/**
 * The homepage product finder — the centrepiece of the layout the owner chose:
 * pick a department, narrow to a sub-category, cap the budget, Search. It lands
 * on /products with the browser's own filters pre-selected, so the results page
 * and this panel can never disagree about what a filter means.
 */
export default function DiscoverPanel({ departments }: { departments: DiscoverDept[] }) {
  const router = useRouter();
  const [dept, setDept] = useState("");
  const [sub, setSub] = useState("");
  const [max, setMax] = useState(0);

  const subs = useMemo(
    () => departments.find((d) => d.name === dept)?.subs ?? [],
    [departments, dept],
  );

  const go = () => {
    const params = new URLSearchParams();
    // The sub-category is the tighter filter when chosen; both are plain
    // category names, which ProductBrowser matches against category OR
    // subcategory — one vocabulary end to end.
    const cat = sub || dept;
    if (cat) params.set("cat", cat);
    if (max > 0) params.set("max", String(max));
    router.push(params.size ? `/products?${params}` : "/products");
  };

  const field = "min-h-12 w-full border border-line bg-white px-3.5 text-[14px] text-ink outline-none focus:border-blue";

  return (
    <div className="border border-line bg-white p-5 sm:p-6">
      <p className="mb-4 text-[17px] font-semibold text-ink">Discover products</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
        <select value={dept} onChange={(e) => { setDept(e.target.value); setSub(""); }} aria-label="Product type" className={field}>
          <option value="">All product types</option>
          {departments.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
        </select>
        <select value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Sub-category" disabled={!subs.length} className={`${field} disabled:opacity-50`}>
          <option value="">{subs.length ? "All sub-categories" : "Sub-category"}</option>
          {subs.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={String(max)} onChange={(e) => setMax(Number(e.target.value))} aria-label="Budget" className={field}>
          <option value="0">Any budget</option>
          {BUDGETS.map((b) => <option key={b} value={b}>Under £{b.toLocaleString("en-GB")}</option>)}
        </select>
        <button onClick={go}
          className="inline-flex min-h-12 items-center justify-center gap-2 bg-cta px-8 text-[14.5px] font-bold text-white transition-colors hover:bg-cta-deep">
          <Search size={16} strokeWidth={2.4} /> Search
        </button>
      </div>
    </div>
  );
}
