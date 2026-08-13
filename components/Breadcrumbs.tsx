import Link from "next/link";
import { ChevronRight } from "lucide-react";

export default function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-ink/60">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1">
          {it.href ? <Link href={it.href} className="hover:text-blue">{it.label}</Link> : <span className="text-ink/80">{it.label}</span>}
          {i < items.length - 1 && <ChevronRight size={14} className="text-ink/70" />}
        </span>
      ))}
    </nav>
  );
}
