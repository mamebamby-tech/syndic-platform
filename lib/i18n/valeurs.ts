import type { createFormatter } from "next-intl";

// Affichage des montants et des dates : le SEUL endroit qui les met en mots.
//
// Deux choses qu'Intl ne fait pas comme un document du cabinet :
//   - la devise. XOF est le code stocké (`immeubles.devise`) ; en français
//     on affiche « FCFA », comme dans tous les documents du cabinet. Aucune
//     conversion : seule l'étiquette change ;
//   - le premier du mois. Le français juridique écrit « 1er octobre 2026 » ;
//     Intl produit « 1 octobre 2026 ».
//
// Ces fonctions sont pures et prennent un formateur : elles servent aussi
// bien aux composants (useValeurs, getValeurs) qu'aux documents et aux
// gabarits de notification, qui n'ont pas de fournisseur de langue.
type Formateur = ReturnType<typeof createFormatter>;

export function estFrancais(locale: string): boolean {
  return locale.split("-")[0] === "fr";
}

// « FCFA » en français, code ISO partout ailleurs.
export function libelleDevise(locale: string): string {
  return estFrancais(locale) ? "FCFA" : "XOF";
}

// Un « 1 » isolé en début de date suivi d'une espace : jamais « 11 », « 21 »
// ni « 31 », dont le « 1 » est suivi d'un chiffre.
const PREMIER_DU_MOIS = /^1(?=[\s  ])/;

export function premierDuMois(texte: string, locale: string): string {
  return estFrancais(locale) ? texte.replace(PREMIER_DU_MOIS, "1er") : texte;
}

const enDate = (valeur: Date | string) => (valeur instanceof Date ? valeur : new Date(valeur));

export function valeursDe(format: Formateur, locale: string) {
  return {
    devise: libelleDevise(locale),
    // Sans décimale ; le code ISO du format est remplacé par l'étiquette.
    montant: (montant: number) =>
      format.number(montant, "xof").replace("XOF", libelleDevise(locale)),
    // « 1er octobre 2026 » / « 1 October 2026 ».
    dateJuridique: (date: Date | string) =>
      premierDuMois(format.dateTime(enDate(date), "dateJuridique"), locale),
    // « 1er oct. 2026 » / « 1 Oct 2026 » : tableaux denses.
    dateCourte: (date: Date | string) =>
      premierDuMois(format.dateTime(enDate(date), "dateJuridiqueCourte"), locale),
  };
}
