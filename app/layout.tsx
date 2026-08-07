import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AnalyticsTracker from "./AnalyticsTracker";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Maryama Ruun | Software Engineer & Full-Stack Developer",
  description:
    "Portfolio of Maryama Ruun, a software engineer and full-stack developer building modern websites, SaaS products, and digital systems.",
  keywords: [
    "Maryama Ruun",
    "Software Engineer Somalia",
    "Full-Stack Developer",
    "Web Developer Mogadishu",
    "React Developer",
  ],
  openGraph: {
    title: "Maryama Ruun | Software Engineer",
    description: "Modern digital products, websites, and full-stack systems built for real use.",
    type: "website",
  },
  other: {
    "codex-preview": "development",
  },
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
