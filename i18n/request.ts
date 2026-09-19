import { getRequestConfig } from "next-intl/server";
import { localeDe } from "@/lib/i18n/config";
import { langueDeLaPersonne } from "@/lib/i18n/langue";
import { chargerMessages } from "@/lib/i18n/messages";
import { formats, FUSEAU } from "@/i18n/formats";

// Pas de préfixe d'URL (/fr/…, /en/…) : la langue est une préférence de la
// personne stockée en base, pas un attribut de l'adresse. Un lien envoyé
// par WhatsApp s'ouvre donc dans la langue de celui qui le reçoit.
export default getRequestConfig(async () => {
  const langue = await langueDeLaPersonne();
  return {
    locale: localeDe(langue),
    messages: await chargerMessages(langue),
    formats,
    timeZone: FUSEAU,
  };
});
