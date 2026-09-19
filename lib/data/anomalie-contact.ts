// Joignabilité d'un propriétaire, PAR CANAL.
//
// Deux canaux d'envoi, indépendants :
//   - WhatsApp : le numéro stocké dans `proprietaires.telephone`. C'est un
//     numéro WhatsApp — c'est l'intitulé de la colonne du registre source,
//     pas un téléphone générique ;
//   - courriel : `proprietaires.email`.
//
// Un contact qui manque sur UN canal n'empêche pas d'écrire à la personne
// par l'autre : ce n'est pas un blocage. Seul l'absence des DEUX rend un
// propriétaire injoignable. Ce n'est pas une règle du règlement de
// copropriété (donc hors du champ de CLAUDE.md règle n°1) : c'est une
// validation de qualité de données, indépendante de l'immeuble.

export type AnomalieContact = "telephone_absent" | "email_absent" | "email_invalide";

export interface ContactProprietaire {
  email: string | null;
  telephone: string | null;
}

// prêt : les deux canaux ; injoignable : aucun.
export type EtatEnvoi = "pret" | "whatsapp_seulement" | "courriel_seulement" | "injoignable";

export interface CanauxDisponibles {
  whatsapp: boolean;
  courriel: boolean;
}

const estRenseigne = (valeur: string | null) => valeur !== null && valeur.trim().length > 0;

export function anomaliesContact(contact: ContactProprietaire): AnomalieContact[] {
  const anomalies: AnomalieContact[] = [];

  if (!estRenseigne(contact.telephone)) {
    anomalies.push("telephone_absent");
  }

  if (!estRenseigne(contact.email)) {
    anomalies.push("email_absent");
  } else if (!contact.email!.includes("@")) {
    anomalies.push("email_invalide");
  }

  return anomalies;
}

// Un canal est disponible quand son contact est présent ET valide : une
// adresse invalide n'ouvre pas le canal courriel.
export function canauxDisponibles(contact: ContactProprietaire): CanauxDisponibles {
  const anomalies = anomaliesContact(contact);
  return {
    whatsapp: !anomalies.includes("telephone_absent"),
    courriel: !anomalies.includes("email_absent") && !anomalies.includes("email_invalide"),
  };
}

export function etatEnvoi(contact: ContactProprietaire): EtatEnvoi {
  const { whatsapp, courriel } = canauxDisponibles(contact);
  if (whatsapp && courriel) return "pret";
  if (whatsapp) return "whatsapp_seulement";
  if (courriel) return "courriel_seulement";
  return "injoignable";
}
