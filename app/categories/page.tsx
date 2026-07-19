import type { Metadata } from "next";
import Link from "next/link";
import { loadCatalog } from "@/lib/repo";
import { topCategories, childCategories } from "@/lib/select";
import PageHead from "@/components/PageHead";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Departments",
  description: "Browse kitchen and home appliances by department at Euronics Ruislip.",
  alternates: { canonical: "/categories" },
};

export default async function CategoriesPage() {
  const { categories } = await loadCatalog();
  const cats = topCategories(categories);
  return (
    <>
      <PageHead eyebrow="Departments" title="Browse by category" intro="Check price, product code and availability — then call" />
      <div className="container-x grid gap-[18px] py-10 md:grid-cols-2 lg:grid-cols-3">
        {cats.map((c) => (
          <div key={c.id} className="flex flex-col rounded-[4px] border border-ink/10 bg-card p-7">
            <Link href={`/categories/${c.id}`} className="font-display text-[28px] font-medium leading-tight hover:text-blue-deep">
              {c.name}
            </Link>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-blue-deep">
              {c.productCount} models
            </p>
            <ul className="mt-5 flex flex-col gap-2">
              {childCategories(categories, c.id).map((ch) => (
                <li key={ch.id}>
                  <Link href={`/categories/${ch.id}`}
                    className="flex items-baseline justify-between gap-3 text-[13.5px] text-muted transition-colors hover:text-blue-deep">
                    <span>{ch.name}</span>
                    <span className="font-mono text-[11px] text-ink/35">{ch.productCount}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
