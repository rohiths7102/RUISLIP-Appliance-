import fs from "fs-extra";
import path from "node:path";
import { fetchWithRetry } from "./http.js";
import { ALLOWED_MEDIA_HOSTS, OUT } from "./config.js";
import type { MediaItem } from "./schemas.js";

const dirFor: Record<MediaItem["type"], string> = {
  product: "products", brand: "brands", page: "pages",
  icon: "misc", banner: "misc", unknown: "misc",
};

/** A brand logo or any asset not on the client's own CDN needs manual permission review. */
function needsReview(item: MediaItem): boolean {
  const host = safeHost(item.sourceUrl);
  const onClientCdn = ALLOWED_MEDIA_HOSTS.some((h) => host.endsWith(h));
  return item.type === "brand" || item.type === "icon" || !onClientCdn;
}
const safeHost = (u: string) => { try { return new URL(u).host; } catch { return ""; } };

/**
 * Download permitted images into /public/imported/** and return the enriched manifest.
 * Only fetches from the client's own hosts/CDN; everything else is flagged for review, not downloaded.
 */
export async function downloadMedia(manifest: MediaItem[], mediaRoot = OUT.media): Promise<MediaItem[]> {
  const out: MediaItem[] = [];
  const seen = new Set<string>();
  for (const raw of manifest) {
    const item: MediaItem = { ...raw, requiresManualPermissionReview: needsReview(raw) };
    if (seen.has(item.sourceUrl)) continue;
    seen.add(item.sourceUrl);

    const host = safeHost(item.sourceUrl);
    const permitted = ALLOWED_MEDIA_HOSTS.some((h) => host.endsWith(h));
    if (!permitted) { out.push(item); continue; }        // flagged, not downloaded

    try {
      const res = await fetchWithRetry(item.sourceUrl);
      const buf = Buffer.from(await res.arrayBuffer());
      const base = path.basename(new URL(item.sourceUrl).pathname).split("?")[0] || "asset";
      const rel = path.join(dirFor[item.type], base);
      const dest = path.join(mediaRoot, rel);
      await fs.ensureDir(path.dirname(dest));
      await fs.writeFile(dest, buf);
      item.localPath = `/imported/${rel.replace(/\\/g, "/")}`;
    } catch {
      item.requiresManualPermissionReview = true;
      item.localPath = "";
    }
    out.push(item);
  }
  return out;
}

// Allow running standalone against an existing media-manifest.json
if (import.meta.url === `file://${process.argv[1]}`) {
  const manifestPath = path.join(OUT.data, "media-manifest.json");
  const manifest = (await fs.readJson(manifestPath)) as MediaItem[];
  const enriched = await downloadMedia(manifest);
  await fs.writeJson(manifestPath, enriched, { spaces: 2 });
  console.log(`Media: processed ${enriched.length}, downloaded ${enriched.filter((m) => m.localPath).length}, flagged ${enriched.filter((m) => m.requiresManualPermissionReview).length}`);
}
