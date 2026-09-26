import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

/**
 * Search-engine crawl log for Admin → Live. middleware.ts posts here (in the
 * background, never delaying the page) whenever a crawler fetches a page, so
 * the owner sees Google crawl his site as it happens — Search Console's crawl
 * stats have no API and lag by days.
 *
 * Stored as TrackedEvent type "bot_crawl": source = the bot, path = the page,
 * landing = verified (the IP is in Google's published Googlebot ranges). No IP
 * is kept. Only middleware can post: it signs with SESSION_SECRET.
 */
const BOTS: [RegExp, string][] = [
  [/Google-InspectionTool/i, "google-inspection"], [/Googlebot-Image/i, "googlebot-image"],
  [/Googlebot/i, "googlebot"], [/Storebot-Google/i, "google-storebot"], [/GoogleOther/i, "google-other"],
  [/bingbot/i, "bingbot"],
];
const crawlerOf = (ua: string) => BOTS.find(([re]) => re.test(ua))?.[1] ?? null;

let ranges: { at: number; cidrs: string[] } | null = null;
async function googleCidrs(): Promise<string[]> {
  if (ranges && Date.now() - ranges.at < 86_400_000) return ranges.cidrs;
  const urls = ["https://developers.google.com/static/search/apis/ipranges/googlebot.json",
    "https://developers.google.com/static/search/apis/ipranges/special-crawlers.json"];
  const cidrs: string[] = [];
  for (const u of urls) {
    const j: any = await fetch(u, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
    for (const p of j?.prefixes || []) cidrs.push(p.ipv4Prefix || p.ipv6Prefix);
  }
  if (cidrs.length) ranges = { at: Date.now(), cidrs };
  return cidrs;
}
function toBig(ip: string): bigint | null {
  if (ip.includes(".")) { const p = ip.split(".").map(Number); return p.length === 4 && p.every((n) => n >= 0 && n < 256) ? p.reduce((a, n) => (a << 8n) | BigInt(n), 0n) : null; }
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const parts = ip.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return parts.length === 8 ? parts.reduce((a, x) => (a << 16n) | BigInt(parseInt(x || "0", 16)), 0n) : null;
}
function inCidr(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/"); const v6 = base.includes(":");
  if (v6 !== ip.includes(":")) return false;
  const a = toBig(ip), b = toBig(base); if (a === null || b === null) return false;
  const width = v6 ? 128n : 32n, shift = width - BigInt(bits);
  return a >> shift === b >> shift;
}

export async function POST(req: Request) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || req.headers.get("x-crawl-key") !== secret) return new NextResponse(null, { status: 204 });
  const b = await req.json().catch(() => null);
  const bot = crawlerOf(String(b?.ua || ""));
  if (!bot) return new NextResponse(null, { status: 204 });
  try {
    const ip = String(b?.ip || "").trim();
    const verified = bot.startsWith("google") && !!ip && (await googleCidrs()).some((c) => inCidr(ip, c));
    const db = await getPrisma();
    await db.trackedEvent.create({ data: { type: "bot_crawl", path: String(b?.path || "").slice(0, 300), source: bot, landing: verified } });
  } catch { /* the log must never matter to anyone */ }
  return new NextResponse(null, { status: 204 });
}
