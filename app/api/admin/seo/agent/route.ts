import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { runSeoAgent } from "@/lib/seo-auto";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST — run the daily SEO agent now (Pricewire → Market → SEO to fix): same rules, same daily cap. */
export async function POST(req: Request) {
  const gate = await requireAdminApi(req, { limit: 4, bucket: "seo-agent" });
  if ("response" in gate) return gate.response;
  const r = await runSeoAgent(await getPrisma(), { by: `${gate.admin.email} (SEO agent, run now)` });
  return NextResponse.json(r);
}
