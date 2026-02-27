import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenGram — A purpose-built chat UI for your AI agents",
  description:
    "A purpose-built chat UI for your AI agents. Open source, self-hosted, mobile-first.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
    ],
  },
  openGraph: {
    title: "OpenGram — Chat UI for AI Agents",
    description:
      "A purpose-built chat UI for your AI agents. Open source, self-hosted, mobile-first.",
    url: "https://opengram.sh",
    siteName: "OpenGram",
    type: "website",
    images: [
      {
        url: "https://opengram.sh/opengram-logo-sm.webp",
        width: 128,
        height: 128,
        alt: "OpenGram logo",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "OpenGram — Chat UI for AI Agents",
    description:
      "A purpose-built chat UI for your AI agents. Open source, self-hosted, mobile-first.",
    site: "@CodingBrice",
    creator: "@CodingBrice",
    images: ["https://opengram.sh/opengram-logo-sm.webp"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans bg-page text-primary antialiased overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
