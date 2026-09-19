import { createTranslator } from "next-intl";
import { formats, FUSEAU } from "@/i18n/formats";
import { localeDe, normaliserLangue } from "@/lib/i18n/config";
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

// BROUILLON — gabarits dont le texte n'a pas été relu et validé par le cabinet.
//
// `appel_emis` (messages/fr.json, `Notifications.appel_emis`) est une
// rédaction provisoire de l'implémentation : ni le ton, ni les mentions, ni
// la formule d'adresse ne sont ceux du cabinet, et un appel de fonds est un
// document à valeur juridique. Il sera relu par le cabinet avant tout envoi
// réel. Tant qu'il figure ici, `rendreNotification` le signale par
// `brouillon: true` : l'expéditeur (à écrire, voir « Envoi effectif » dans
// docs/06-decisions.md) doit refuser d'envoyer un brouillon à un
// destinataire réel.
//
// Le retirer de cette liste est le geste qui consigne la validation du
// cabinet ; ne le faire qu'après relecture, pas pour « débloquer » un envoi.
export const GABARITS_BROUILLON: ReadonlySet<DemandeNotification["gabarit"]> = new Set([
  "appel_emis",
]);

export interface NotificationRendue {
  // Objet du courriel ; absent pour WhatsApp.
  sujet?: string;
  corps: string;
  // Vrai tant que le texte du gabarit n'a pas été validé par le cabinet.
  brouillon: boolean;
}

export async function rendreNotification(
  demande: DemandeNotification,
): Promise<NotificationRendue> {
  const langue = normaliserLangue(demande.langue);
  const messages = await chargerMessages(langue);
  const brouillon = GABARITS_BROUILLON.has(demande.gabarit);

  switch (demande.gabarit) {
    case "appel_emis": {
      const t = createTranslator({
        locale: localeDe(langue),
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
        ? { sujet: t("email.sujet", valeurs), corps: t("email.corps", valeurs), brouillon }
        : { corps: t("whatsapp.corps", valeurs), brouillon };
    }
  }
}
