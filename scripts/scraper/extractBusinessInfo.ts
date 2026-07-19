import * as cheerio from "cheerio";
import type { Business } from "./schemas.js";

const text = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Extract business/contact info from the contact + about pages.
 * `base` lets you pass known-good values (from the client brief) that take
 * precedence over anything ambiguous on the page.
 */
export function extractBusinessInfo(htmls: string[], base: Partial<Business> = {}): Business {
  const joined = htmls.join("\n");
  const $ = cheerio.load(joined);

  const tel = $('a[href^="tel:"]').first().attr("href")?.replace("tel:", "") || "";
  const email = $('a[href^="mailto:"]').first().attr("href")?.replace("mailto:", "") || "";

  const social: { platform: string; url: string }[] = [];
  $('a[href*="facebook.com"], a[href*="instagram"], a[href*="twitter"], a[href*="x.com"], a[href*="youtube"]').each((_, a) => {
    const url = $(a).attr("href") || "";
    const platform = /facebook/.test(url) ? "facebook"
      : /instagram/.test(url) ? "instagram"
      : /youtube/.test(url) ? "youtube"
      : /twitter|x\.com/.test(url) ? "twitter" : "web";
    if (url && !social.find((s) => s.url === url)) social.push({ platform, url });
  });

  const merged: Business = {
    businessName: base.businessName || "Jyotsna Electrical Ltd",
    tradingName: base.tradingName || "Euronics Ruislip",
    phone: base.phone || (tel ? text(tel) : ""),
    email: base.email || email,
    address: base.address || {
      line1: "724 Fieldend Road", line2: "South Ruislip", county: "Middlesex",
      postcode: "HA4 0QP", country: "United Kingdom",
    },
    openingHours: base.openingHours || {},
    delivery: base.delivery || { radius: "", notes: "", timescale: "" },
    socialLinks: base.socialLinks?.length ? base.socialLinks : social,
    mapQuery: base.mapQuery || "",
    googleMapsEmbedUrl: base.googleMapsEmbedUrl || "",
    googleMapsDirectionsUrl: base.googleMapsDirectionsUrl || "",
  };

  // Always regenerate safe Google Maps links from the full address.
  const addr = [merged.businessName, merged.address.line1, merged.address.line2,
    merged.address.county, merged.address.postcode].filter(Boolean).join(", ");
  merged.mapQuery = merged.mapQuery || addr;
  const q = encodeURIComponent(addr);
  merged.googleMapsDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  if (!merged.googleMapsEmbedUrl) {
    merged.googleMapsEmbedUrl = `https://www.google.com/maps?q=${q}&output=embed`;
  }
  return merged;
}
