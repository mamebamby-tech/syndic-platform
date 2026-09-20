import type { MoyenPaiement } from "@/lib/types/database";

// Ce que le formulaire de saisie d'un paiement peut envoyer, et ce que la base peut
// refuser. La sécurité ne repose PAS sur ce fichier : la base refuse ce qui est faux
// (déclencheurs, droits). Ceci donne des messages précis avant l'aller-retour.

// Les moyens qu'on saisit à la main. « cheque » existe dans la base mais n'est pas
// offert : un chèque peut être impayé, ce qui demande une décision (question ouverte).
export const MOYENS_SAISIE = ["virement", "virement_international", "especes", "wave", "orange_money"] as const satisfies readonly MoyenPaiement[];

export type CodeErreurPaiement =
  | "appel_requis"
  | "montant_invalide"
  | "moyen_invalide"
  | "date_invalide"
  | "date_future"
  | "reference_trop_longue"
  | "paiement_requis"
  | "motif_requis"
  | "motif_trop_long"
  | "appel_non_payable"
  | "depasse_reste_du"
  | "deja_annule"
  | "non_annulable"
  | "destinataire_different"
  | "acces_refuse"
  | "enregistrement_impossible";

export type ErreursPaiement = Partial<Record<"appel" | "montant" | "moyen" | "date" | "reference" | "paiement" | "motif" | "general", CodeErreurPaiement>>;

export const LONGUEUR_MAX_REFERENCE = 120;
export const LONGUEUR_MAX_MOTIF = 500;

// Le FCFA n'a pas de subdivision : un montant entier, écrit comme on l'écrit
// (« 150 000 », espaces ordinaires ou insécables). Pas de décimales, pas de signe.
const MONTANT_MAX = 999_999_999_999; // numeric(14,2) : douze chiffres entiers

export function lireMontant(brut: string): number | null {
  const net = brut.replace(/[\s  ]/g, "");
  if (!/^\d+$/.test(net)) return null;
  const montant = Number(net);
  return montant > 0 && montant <= MONTANT_MAX ? montant : null;
}

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
function dateValide(brut: string): boolean {
  const m = DATE_ISO.exec(brut);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export interface EntreePaiement {
  appelId: string;
  montant: string;
  moyen: string;
  date: string;
  reference: string;
}

export interface PaiementValide {
  appelId: string;
  montant: number;
  moyen: (typeof MOYENS_SAISIE)[number];
  date: string;
  reference: string | null;
}

// `aujourdhui` : AAAA-MM-JJ, fourni par l'appelant (testable, et identique à la date
// que la base compare).
export function validerPaiement(
  entree: EntreePaiement,
  aujourdhui: string,
): { valeurs: PaiementValide | null; erreurs: ErreursPaiement } {
  const erreurs: ErreursPaiement = {};
  if (!entree.appelId.trim()) erreurs.appel = "appel_requis";

  const montant = lireMontant(entree.montant);
  if (montant === null) erreurs.montant = "montant_invalide";

  const moyen = MOYENS_SAISIE.find((m) => m === entree.moyen);
  if (!moyen) erreurs.moyen = "moyen_invalide";

  const date = entree.date.trim();
  if (!dateValide(date)) erreurs.date = "date_invalide";
  else if (date > aujourdhui) erreurs.date = "date_future";

  const reference = entree.reference.trim();
  if (reference.length > LONGUEUR_MAX_REFERENCE) erreurs.reference = "reference_trop_longue";

  if (Object.keys(erreurs).length > 0 || montant === null || !moyen) return { valeurs: null, erreurs };
  return {
    valeurs: { appelId: entree.appelId.trim(), montant, moyen, date, reference: reference || null },
    erreurs,
  };
}

export function validerAnnulation(entree: { paiementId: string; motif: string }): {
  valeurs: { paiementId: string; motif: string } | null;
  erreurs: ErreursPaiement;
} {
  const erreurs: ErreursPaiement = {};
  const motif = entree.motif.trim();
  if (!entree.paiementId.trim()) erreurs.paiement = "paiement_requis";
  if (!motif) erreurs.motif = "motif_requis";
  else if (motif.length > LONGUEUR_MAX_MOTIF) erreurs.motif = "motif_trop_long";
  if (Object.keys(erreurs).length > 0) return { valeurs: null, erreurs };
  return { valeurs: { paiementId: entree.paiementId.trim(), motif }, erreurs };
}

// Ce que la base répond → un code que l'écran met en mots. Les codes PA0xx sont ceux de
// 20260920020000_paiements_manuels.sql.
const PAR_CODE_SQL: Record<string, { champ: keyof ErreursPaiement; code: CodeErreurPaiement }> = {
  "42501": { champ: "general", code: "acces_refuse" },
  PA001: { champ: "appel", code: "appel_non_payable" },
  PA002: { champ: "montant", code: "depasse_reste_du" },
  PA003: { champ: "moyen", code: "moyen_invalide" },
  PA004: { champ: "montant", code: "montant_invalide" },
  PA005: { champ: "paiement", code: "deja_annule" },
  PA006: { champ: "motif", code: "motif_requis" },
  PA007: { champ: "date", code: "date_future" },
  PA008: { champ: "paiement", code: "non_annulable" },
  PA009: { champ: "appel", code: "destinataire_different" },
  // Unicité de l'annulation : deux annulations simultanées du même paiement.
  "23505": { champ: "paiement", code: "deja_annule" },
};

export function erreurDeLaBase(erreur: { code?: string | null }): ErreursPaiement {
  const connue = erreur.code ? PAR_CODE_SQL[erreur.code] : undefined;
  return connue ? { [connue.champ]: connue.code } : { general: "enregistrement_impossible" };
}

export interface EtatPaiement {
  statut: "initial" | "ok" | "erreur";
  erreurs: ErreursPaiement;
}
export const ETAT_PAIEMENT_INITIAL: EtatPaiement = { statut: "initial", erreurs: {} };
