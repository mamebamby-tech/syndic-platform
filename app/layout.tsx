import type { Metadata } from "next";
import { Newsreader, Public_Sans } from "next/font/google";
import { nom, baseline } from "@/lib/marque";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${nom} — ${baseline}`,
  description: "Plateforme de gestion de syndic multi-cabinet et multi-immeuble.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={`${newsreader.variable} ${publicSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
