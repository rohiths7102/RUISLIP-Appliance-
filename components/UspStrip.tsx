/**
 * Slim persistent USP bar under the header — the four answers every white-goods
 * customer wants before anything else, stated once and honestly (AO's trust
 * play executed with local truth). Facts only: these claims already appear on
 * the delivery/about pages; keep the two lists in step if they change.
 */
import { Truck, Wrench, Recycle, Users } from "lucide-react";

const USPS = [
  [Truck, "Own-van local delivery"],
  [Wrench, "Installation & fitting"],
  [Recycle, "Old appliance recycling"],
  [Users, "Family-run since 1977"],
] as const;

export default function UspStrip() {
  return (
    <div className="border-b border-line bg-paper-2">
      <div className="container-x flex items-center justify-between gap-4 overflow-x-auto py-2">
        {USPS.map(([Icon, label]) => (
          <span key={label} className="flex shrink-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-blue-deep">
            <Icon size={13} strokeWidth={2.2} className="text-blue" aria-hidden />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
