import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AnalyticsTracker from "./AnalyticsTracker";
import { defaultSettings } from "./site-data";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : defaultSettings.site_url)),
  title: {
    default: "Maryama Ruun | Software Engineer & Full-Stack Developer",
    template: "%s | Maryama Ruun",
  },
  description:
    "Portfolio of Maryama Ruun, a software engineer and full-stack developer building modern websites, SaaS products, and digital systems.",
  keywords: [
    "Maryama Ruun",
    "Software Engineer Somalia",
    "Full-Stack Developer",
    "Web Developer Mogadishu",
    "React Developer",
  ],
  authors: [{ name: "Maryama Ruun", url: defaultSettings.site_url }],
  openGraph: {
    title: "Maryama Ruun | Software Engineer",
    description: "Modern digital products, websites, and full-stack systems built for real use.",
    type: "website",
    siteName: "Maryama Ruun",
    images: [{ url: "/maryama-ruun.png", alt: "Maryama Ruun, Software Engineer and Full-Stack Developer" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Maryama Ruun | Software Engineer",
    description: "Modern digital products, websites, and full-stack systems built for real use.",
    images: ["/maryama-ruun.png"],
  },
  robots: { index: true, follow: true },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AnalyticsTracker />
        {children}
      </body>
    </html>
  );
}
