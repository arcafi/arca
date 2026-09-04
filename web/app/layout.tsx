import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { SmoothScroll } from "./components/SmoothScroll";
import { Cursor } from "./components/Cursor";

// Editorial serif display (heritage / vault) — the vanlent-style headline voice
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});
// Clean geometric grotesk — echoes the rounded arca wordmark
const body = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Arca — the vault that guards itself",
  description:
    "A fully-backed stock index on Robinhood Chain. An autonomous agent rebalances the basket; no one can withdraw it. Every weight, rebalance and price on-chain. Don't trust — look inside.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} antialiased`}
    >
      <body className="min-h-dvh bg-canvas text-ink font-body">
        <SmoothScroll />
        <Cursor />
        {children}
      </body>
    </html>
  );
}
