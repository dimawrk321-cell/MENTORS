import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@/styles/globals.css";
import { Toaster } from "@/components/ui/toast";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "PRIME";
const platformUrl = process.env.PLATFORM_URL ?? "http://localhost:3000";
// og slogan (spec 13.2 block 1) — the share-preview one-liner.
const SLOGAN = "Платформа подготовки к ML-собеседованиям";

export const metadata: Metadata = {
  // Absolute base for og:image/og:url (spec 13.2 block 1) — from env, not hardcoded.
  metadataBase: new URL(platformUrl),
  title: {
    default: brandName,
    template: `%s · ${brandName}`,
  },
  description: "Закрытая платформа подготовки к карьере в ML / DS / NLP / AI Engineering",
  applicationName: brandName,
  // DECISION: closed platform (only /login is public) — keep it out of search indexes.
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: brandName,
    title: brandName,
    description: SLOGAN,
    locale: "ru_RU",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: brandName,
    description: SLOGAN,
  },
};

// Anti-FOUC (spec 5.1): resolve theme before first paint.
// localStorage "theme" holds "dark" | "light" | anything else = system preference.
const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");if(t!=="dark"&&t!=="light"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        {/* DECISION: App Router forbids a manual <head>; a synchronous script as the
            first element of <body> executes before first paint — equivalent effect. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
