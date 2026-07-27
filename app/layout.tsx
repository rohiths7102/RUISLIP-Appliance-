import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ChatWidget from "@/components/ChatWidget";
import PostcodePrompt from "@/components/PostcodePrompt";
import CallTracker from "@/components/CallTracker";
import ConsentAnalytics from "@/components/ConsentAnalytics";
import { getBusiness } from "@/lib/repo";

const AREAS_SERVED = [
  "Ruislip", "South Ruislip", "Ruislip Manor", "Eastcote", "Northolt",
  "Pinner", "Ickenham", "Uxbridge", "Hillingdon", "Harrow", "West London",
];

export async function generateMetadata(): Promise<Metadata> {
  const business = await getBusiness();
  const { postcode } = business.address;
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3005"),
    title: {
      default: `${business.tradingName} | Kitchen & Home Appliances in Ruislip, West London`,
      // tradingName already contains "Ruislip" — appending the locality again
      // produced "… | Euronics Ruislip Ruislip", classic keyword-stuffing smell.
      template: `%s | ${business.tradingName}`,
    },
    description:
      `Kitchen & home appliances from a family-run shop in South Ruislip (${postcode}), established 1977. Washing machines, fridge freezers, dishwashers, ovens, TVs and more from top brands — with local delivery and installation across West London. Browse online, then call ${business.phone} to confirm stock and price.`,
    keywords: [
      "appliances Ruislip", "kitchen appliances Ruislip", "appliance shop South Ruislip",
      "washing machines Ruislip", "fridge freezers Ruislip", "dishwashers Ruislip",
      "Euronics Ruislip", "appliance delivery West London", "HA4 appliances",
    ],
    alternates: { canonical: "/" },
    openGraph: {
      type: "website", siteName: business.tradingName, locale: "en_GB",
      title: `${business.tradingName} — Kitchen & Home Appliances in Ruislip`,
      description: `1,500+ appliances from ${business.tradingName}, the family-run appliance shop in South Ruislip since 1977. Call ${business.phone}.`,
      images: [{ url: "/og.jpg", width: 1200, height: 630, alt: `${business.tradingName} — premium kitchen appliances` }],
    },
    twitter: { card: "summary_large_image", title: `${business.tradingName} | Appliances in Ruislip`, images: ["/og.jpg"] },
    formatDetection: { telephone: true },
  };
}

/** Organization (carries the logo Google shows in results) + sitelinks search box. */
function BrandSchema({ business }: { business: any }) {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3005";
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${base}/#org`,
    name: business.tradingName,
    legalName: business.businessName,
    url: base,
    logo: { "@type": "ImageObject", url: `${base}/brand/euronics-badge.png`, width: 512, height: 512 },
    foundingDate: "1977",
    telephone: business.phone,
    sameAs: (business.socialLinks || []).map((s: any) => s.url),
  };
  const site = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${base}/#website`,
    url: base,
    name: business.tradingName,
    publisher: { "@id": `${base}/#org` },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${base}/products?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(org) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(site) }} />
    </>
  );
}

function LocalBusinessSchema({ business }: { business: any }) {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3005";
  const data = {
    "@context": "https://schema.org",
    "@type": "HomeGoodsStore",
    "@id": `${base}/#store`,
    name: business.businessName,
    alternateName: business.tradingName,
    description: `Family-run kitchen & home appliance shop in South Ruislip since 1977, serving Ruislip and West London.`,
    telephone: business.phone,
    email: business.email || undefined,
    url: base,
    priceRange: "££",
    image: `${base}/hero/hero-poster-4k.jpg`,
    address: {
      "@type": "PostalAddress",
      streetAddress: `${business.address.line1}, ${business.address.line2}`,
      addressLocality: "Ruislip",
      addressRegion: business.address.county,
      postalCode: business.address.postcode,
      addressCountry: "GB",
    },
    geo: { "@type": "GeoCoordinates", latitude: 51.55557, longitude: -0.37822 },
    hasMap: business.googleMapsDirectionsUrl || undefined,
    areaServed: AREAS_SERVED.map((name) => ({ "@type": "City", name })),
    openingHoursSpecification: [
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], opens: "09:00", closes: "17:30" },
    ],
    sameAs: (business.socialLinks || []).map((s: any) => s.url),
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const business = await getBusiness();
  return (
    <html lang="en-GB">
      <body>
        <LocalBusinessSchema business={business} />
        <BrandSchema business={business} />
        <Header business={business} />
        <main className="min-h-[60vh]">{children}</main>
        <Footer business={business} />
        <ChatWidget phone={business.phone} />
        <PostcodePrompt phone={business.phone} />
        <CallTracker />
        <ConsentAnalytics />
      </body>
    </html>
  );
}
