import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { cookies } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { I18nProvider } from "@/components/I18nProvider";
import {
  defaultUiLocale,
  localeHtmlLang,
  normalizeUiLocale,
  uiLocaleCookieName,
} from "@/lib/i18n";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "FollowBrief",
  description:
    "Follow sources, build AI Brief, and search your workspace.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const initialLocale =
    normalizeUiLocale(cookieStore.get(uiLocaleCookieName)?.value) ?? defaultUiLocale;

  return (
    <html
      lang={localeHtmlLang(initialLocale)}
      data-locale={initialLocale}
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} fb-root`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('fb-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="fb-root-body">
        <I18nProvider initialLocale={initialLocale}>{children}</I18nProvider>
        <Analytics />
      </body>
    </html>
  );
}
