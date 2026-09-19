import { createTranslator } from "next-intl";
import { formats, FUSEAU } from "@/i18n/formats";
import { normaliserLangue } from "@/lib/i18n/config";
import { chargerMessages } from "@/lib/i18n/messages";

// Gabarits de notification (courriel, WhatsApp). La langue est celle du
// DESTINATAIRE — `proprietaires.langue` — pas celle du syndic qui déclenche
// l'envoi. Une clé manquante dans la langue du destinataire retombe sur le
// français (voir lib/i18n/messages.ts).
//
// Comme les documents, ces textes portent l'identité du cabinet, jamais le
// nom du produit (lib/marque.ts).
//
// Le `gabarit` ci-dessous est la valeur stockée dans `notifications.gabarit`.
// WhatsApp Business n'envoie hors conversation que des modèles pré-approuvés
// par Meta, un par langue : le jour de l'envoi effectif, chaque couple
// (gabarit, langue) devra avoir son modèle approuvé côté Meta, et la langue
// du destinataire choisira lequel.
export type CanalNotification = "email" | "whatsapp";

export interface ChargeUtileAppelEmis {
  cabinet: string;
  reference: string;
  periode: string;
  montant: number;
  // Date de calendrier `AAAA-MM-JJ`, telle que stockée dans `appels`.
  echeance: string;
}

export type DemandeNotification = {
  gabarit: "appel_emis";
  canal: CanalNotification;
  // Valeur brute de `proprietaires.langue` : normalisée ici.
  langue: string | null;
  chargeUtile: ChargeUtileAppelEmis;
};

export interface NotificationRendue {
  // Objet du courriel ; absent pour WhatsApp.
  sujet?: string;
  corps: string;
}

export async function rendreNotification(
  demande: DemandeNotification,
): Promise<NotificationRendue> {
  const langue = normaliserLangue(demande.langue);
  const messages = await chargerMessages(langue);

  switch (demande.gabarit) {
    case "appel_emis": {
      const t = createTranslator({
        locale: langue,
        messages,
        formats,
        timeZone: FUSEAU,
        namespace: "Notifications.appel_emis",
      });
      const valeurs = {
        ...demande.chargeUtile,
        echeance: new Date(demande.chargeUtile.echeance),
      };

      return demande.canal === "email"
        ? { sujet: t("email.sujet", valeurs), corps: t("email.corps", valeurs) }
        : { corps: t("whatsapp.corps", valeurs) };
    }
  }
}
