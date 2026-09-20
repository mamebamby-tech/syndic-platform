import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { Newsreader, Public_Sans } from "next/font/google";
import { messagesPourLeNavigateur } from "@/lib/i18n/messages";
import { nom, baseline } from "@/lib/marque";
import { enDemonstration, robotsDeLaPage } from "@/lib/demonstration";
import { BandeauDemonstration } from "@/components/ui/bandeau-demonstration";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
    title: `${nom} — ${baseline}`,
    description: t("description"),
    // <meta name="robots" content="noindex, nofollow"> en démonstration seulement.
    robots: robotsDeLaPage(),
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  const tDemonstration = await getTranslations("Demonstration");

  return (
    <html lang={locale} className={`${newsreader.variable} ${publicSans.variable}`}>
      <body>
        {enDemonstration() && <BandeauDemonstration texte={tDemonstration("bandeau")} />}
        <NextIntlClientProvider messages={messagesPourLeNavigateur(messages)}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
