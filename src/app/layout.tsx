import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/playfair-display";
import "./globals.css";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
export const metadata: Metadata = {
  metadataBase: new URL("https://etlinkcoffee.com"),
  title: { default: "ET Link Coffee | Ethiopian Coffee. Connected Globally.", template: "%s | ET Link Coffee" },
  description: "ET Link connects Ethiopian coffee suppliers and exporters with domestic and international buyers through private, manually reviewed trade introductions.",
  openGraph: { type: "website", locale: "en_US", siteName: "ET Link Coffee", title: "ET Link Coffee", description: "Ethiopian Coffee. Connected Globally.", images: [{ url: "/brand/brand-signature.webp", width: 900, height: 900, alt: "ET Link Coffee gold logo" }] },
  twitter: { card: "summary_large_image", title: "ET Link Coffee", description: "Ethiopian Coffee. Connected Globally.", images: ["/brand/brand-signature.webp"] },
  icons: { icon: "/brand/orbital-bean.webp" }
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" data-scroll-behavior="smooth"><body className="flex min-h-screen flex-col font-sans antialiased"><a href="#main-content" className="sr-only fixed top-4 left-4 z-50 rounded bg-ivory px-4 py-3 text-deep-green focus:not-sr-only focus:fixed">Skip to content</a><SiteHeader /><main id="main-content" tabIndex={-1} className="flex-1">{children}</main><SiteFooter /></body></html>; }