import { requireAdmin } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { loadCatalog } from "@/lib/repo";
import AdminShell from "@/components/admin/AdminShell";
import BusinessSettings from "@/components/admin/BusinessSettings";
import { Card, Badge } from "@/components/admin/ui";
import { graphConfigured } from "@/lib/mailer";
import { groqConfigured } from "@/lib/chat/groq";
import { Mail, Bot } from "lucide-react";
export const dynamic = "force-dynamic";

async function businessForm() {
  try {
    const db = await getPrisma();
    const r = await db.businessInfo.findUnique({ where: { id: "business" } });
    if (r) return { businessName: r.businessName, tradingName: r.tradingName, phone: r.phone, email: r.email, deliveryRadius: r.deliveryRadius, mapQuery: r.mapQuery, googleMapsEmbedUrl: r.googleMapsEmbedUrl, address: r.address, openingHours: r.openingHours };
  } catch {}
  const b = (await loadCatalog()).business;
  return { businessName: b.businessName, tradingName: b.tradingName, phone: b.phone, email: b.email, deliveryRadius: b.delivery.radius, mapQuery: b.mapQuery, googleMapsEmbedUrl: b.googleMapsEmbedUrl, address: b.address, openingHours: b.openingHours };
}

export default async function AdminSettings() {
  const admin = await requireAdmin();
  const data = await businessForm();
  const outlook = graphConfigured();
  const ai = groqConfigured();
  return (
    <AdminShell active="/admin/settings" email={admin.email}>
      <BusinessSettings initial={data} />

      {/* ---- integrations: what's wired into the panel, honestly stated ---- */}
      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-blue-deep">Integrations</h2>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue/10"><Mail size={18} className="text-blue-deep" /></span>
              <div>
                <p className="text-[14px] font-semibold">Microsoft 365 Outlook</p>
                <p className="text-[12px] text-muted">One-click lead emails from the shop&apos;s own mailbox</p>
              </div>
            </div>
            <Badge tone={outlook ? "success" : "neutral"}>{outlook ? "connected" : "not connected"}</Badge>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink/70">
            {outlook
              ? "Sales & Leads sends replies through Microsoft Graph from your mailbox, and every send lands in your own Sent folder."
              : "The send path is already built in. When your Entra admin creates an app registration with the Mail.Send permission, add MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and MS_SENDER_UPN to the environment — the “Send via Outlook” button in Sales & Leads lights up with no other change. Until then that button hands drafts to your own email app."}
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue/10"><Bot size={18} className="text-blue-deep" /></span>
              <div>
                <p className="text-[14px] font-semibold">AI (Groq)</p>
                <p className="text-[12px] text-muted">Powers the customer chatbot and lead reply drafting</p>
              </div>
            </div>
            <Badge tone={ai ? "success" : "warning"}>{ai ? "active" : "no key"}</Badge>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink/70">
            {ai
              ? "Drafts are grounded in your real catalogue: published prices are quoted exactly, call-for-price items get an [ADD YOUR PRICE] gap, and it never invents a number."
              : "Set GROQ_API_KEY to enable the chatbot and AI reply drafting."}
          </p>
        </Card>
      </div>
    </AdminShell>
  );
}
