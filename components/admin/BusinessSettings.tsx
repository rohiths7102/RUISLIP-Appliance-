"use client";
import { useState } from "react";
import { Button, Notice, PageTitle } from "@/components/admin/ui";
export default function BusinessSettings({ initial }: { initial: any }) {
  const [f, setF] = useState<any>(initial);
  const [msg, setMsg] = useState(""); const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const setAddr = (k: string, v: any) => setF((s: any) => ({ ...s, address: { ...s.address, [k]: v } }));
  const setHours = (d: string, v: any) => setF((s: any) => ({ ...s, openingHours: { ...s.openingHours, [d]: v } }));
  async function save() {
    setSaving(true); setMsg("");
    const r = await fetch("/api/admin/business", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    setSaving(false); setMsg(r.ok ? "Saved ✓" : "Save failed — is the database running?");
  }
  return (
    <div className="max-w-2xl">
      <PageTitle actions={msg ? <Notice tone={msg === "Saved ✓" ? "success" : "danger"}>{msg}</Notice> : undefined}>Business settings</PageTitle>
      <div className="mt-6 grid gap-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <label>Business name<input value={f.businessName} onChange={(e) => set("businessName", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
          <label>Trading name<input value={f.tradingName} onChange={(e) => set("tradingName", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
          <label>Phone<input value={f.phone} onChange={(e) => set("phone", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
          <label>Email<input value={f.email} onChange={(e) => set("email", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label>Address line 1<input value={f.address?.line1 || ""} onChange={(e) => setAddr("line1", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
          <label>Address line 2<input value={f.address?.line2 || ""} onChange={(e) => setAddr("line2", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
          <label>County<input value={f.address?.county || ""} onChange={(e) => setAddr("county", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
          <label>Postcode<input value={f.address?.postcode || ""} onChange={(e) => setAddr("postcode", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
        </div>
        <label>Delivery radius<input value={f.deliveryRadius || ""} onChange={(e) => set("deliveryRadius", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>

        {/* Trading disclosures. Left blank the site shows nothing at all, which is
            lawful; a wrong number is not. So these stay empty until the owner
            types the real ones off the Companies House record / VAT certificate. */}
        <div>
          <div className="font-medium">Legal &amp; trading details</div>
          <p className="mt-1 text-xs text-muted">
            Shown in the footer and on the Terms page. Each line is hidden while blank — leave a field empty
            rather than guessing, and copy the values exactly from your Companies House record and VAT certificate.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label>Company number<input value={f.companyNumber || ""} onChange={(e) => set("companyNumber", e.target.value)} placeholder="e.g. 01234567" className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
            <label>Place of registration<input value={f.placeOfRegistration || ""} onChange={(e) => set("placeOfRegistration", e.target.value)} placeholder="England and Wales" className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
            <label>VAT number<input value={f.vatNumber || ""} onChange={(e) => set("vatNumber", e.target.value)} placeholder="e.g. GB123456789" className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
            <label>Registered office<input value={f.registeredOffice || ""} onChange={(e) => set("registeredOffice", e.target.value)} placeholder="If different from the shop address" className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
          </div>
        </div>
        <label>Google Maps embed URL<input value={f.googleMapsEmbedUrl || ""} onChange={(e) => set("googleMapsEmbedUrl", e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5" /></label>
        <div>
          <div className="font-medium">Opening hours</div>
          <div className="mt-2 grid gap-2">
            {Object.keys(f.openingHours || {}).map((d) => (
              <div key={d} className="grid grid-cols-3 items-center gap-2"><span className="capitalize text-muted">{d}</span><input value={f.openingHours[d]} onChange={(e) => setHours(d, e.target.value)} className="col-span-2 rounded border border-line px-2 py-1.5" /></div>
            ))}
          </div>
        </div>
        <div><Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button></div>
      </div>
    </div>
  );
}
