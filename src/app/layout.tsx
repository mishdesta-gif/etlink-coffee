import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/playfair-display";
import "./globals.css";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

export const metadata: Metadata = {
  title: { default: "ET Link Coffee | Ethiopian origins, meaningful connections", template: "%s | ET Link Coffee" },
  description: "ET Link Coffee is building a platform for Ethiopian coffee trade and business connections.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <a href="#main-content" className="sr-only fixed top-4 left-4 z-50 rounded bg-ivory px-4 py-3 text-deep-green focus:not-sr-only">Skip to content</a>
        <SiteHeader />
        <main id="main-content" tabIndex={-1} className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
