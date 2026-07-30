/**
 * Energy-rating extraction — the signature merchandising element of appliance
 * retail. 228 of the catalogue's products carry a clean class in their specs
 * under labels like "Energy efficiency class" / "Energy efficiency rating",
 * with values A–G plus the legacy A+/A++/A+++ scale on older stock. We display
 * exactly what the record says (never remap legacy plus-classes onto the new
 * scale — that would misstate the label).
 */
export type EnergyClass = "A+++" | "A++" | "A+" | "A" | "B" | "C" | "D" | "E" | "F" | "G";

const VALUE_RX = /^([A-G])(\+{1,3})?$/;

/** Pull the energy class from a product's specifications array, or null. */
export function energyClassOf(specifications: unknown): EnergyClass | null {
  if (!Array.isArray(specifications)) return null;
  for (const s of specifications as Array<{ label?: unknown; value?: unknown }>) {
    const label = String(s?.label ?? "").toLowerCase();
    if (!label.includes("energy")) continue;
    const m = String(s?.value ?? "").trim().toUpperCase().match(VALUE_RX);
    if (m) return `${m[1]}${m[2] ?? ""}` as EnergyClass;
  }
  return null;
}

/** Semantic tone for the chip — A-band green, mid amber, F/G red (tokens). */
export function energyTone(cls: EnergyClass): "success" | "warning" | "danger" {
  if (cls.startsWith("A") || cls === "B") return "success";
  if (cls === "F" || cls === "G") return "danger";
  return "warning";
}

/** Letter used for sorting/filtering (legacy A+ variants group under A). */
export const energyLetter = (cls: EnergyClass) => cls[0] as "A" | "B" | "C" | "D" | "E" | "F" | "G";
