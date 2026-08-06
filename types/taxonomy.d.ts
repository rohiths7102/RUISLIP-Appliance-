/** Types for the catalogue taxonomy engine (scripts/catalog/taxonomy.mjs). */
declare module "*/scripts/catalog/taxonomy.mjs" {
  export function classify(r: {
    name: string;
    description: string;
    source?: string;
    key?: string;
    source_url?: string;
  }): { leaf: string; how: string };
  export const LEAF: Map<string, { leafId: string; leafName: string; topId: string; topName: string }>;
  export const TOP: Map<string, { id: string; name: string; children: { id: string; name: string }[] }>;
}
