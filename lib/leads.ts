import type { Tone } from "@/components/admin/ui";

/**
 * Lead pipeline stages, shared by Sales & Leads and the Dashboard so a stage
 * looks the same everywhere. "closed" is legacy data — shown as won.
 * "New" is the one that needs a reply, so it gets the attention colour.
 */
export const STAGES = ["new", "contacted", "quoted", "won", "lost"] as const;
export const stageOf = (s: string) => (s === "closed" ? "won" : s);
export const STAGE_TONE: Record<string, Tone> = { new: "warning", contacted: "info", quoted: "info", won: "success", lost: "neutral" };
export const STAGE_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", quoted: "Quoted", won: "Won", lost: "Lost" };
