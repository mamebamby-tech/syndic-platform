// Anomalies de contact qui bloquent l'envoi d'un document à un
// propriétaire. Ce n'est pas une règle du règlement de copropriété (donc
// hors du champ de CLAUDE.md règle n°1) : c'est une validation de qualité
// de données, indépendante de l'immeuble.

export type AnomalieContact = "telephone_absent" | "email_absent" | "email_invalide";

export interface ContactProprietaire {
  email: string | null;
  telephone: string | null;
}

export const LIBELLES_ANOMALIE_CONTACT: Record<AnomalieContact, string> = {
  telephone_absent: "aucun numéro de téléphone",
  email_absent: "aucune adresse électronique",
  email_invalide: "adresse électronique invalide",
};

export function anomaliesContact(contact: ContactProprietaire): AnomalieContact[] {
  const anomalies: AnomalieContact[] = [];

  if (!contact.telephone) {
    anomalies.push("telephone_absent");
  }

  if (!contact.email) {
    anomalies.push("email_absent");
  } else if (!contact.email.includes("@")) {
    anomalies.push("email_invalide");
  }

  return anomalies;
}
