import type { Formats } from "next-intl";

// Formats nommés, partagés par l'interface, les documents et les gabarits
// de notification. Un seul endroit : ce que la locale change (séparateurs,
// ordre jour/mois), pas ce que le format signifie.
//
// La devise stockée est XOF, dans toutes les langues : aucune conversion.
// Son AFFICHAGE varie : « FCFA » en français, comme dans tous les documents
// du cabinet, « XOF » en anglais. Ce format produit le code ISO ; le
// remplacement par « FCFA » se fait dans lib/i18n/valeurs.ts, seul endroit
// autorisé à l'employer (tests/i18n.test.ts).
export const formats = {
  number: {
    xof: {
      style: "currency",
      currency: "XOF",
      currencyDisplay: "code",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    },
    pourcentage: {
      style: "percent",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  },
  dateTime: {
    // Toute date affichée aujourd'hui est à portée juridique ou financière
    // (échéance, mouvement, et demain convocation, séance) : le mois est
    // TOUJOURS en toutes lettres — « 1 October 2026 », « 1 octobre 2026 » —
    // jamais en chiffres, qui se lisent différemment d'un pays à l'autre.
    // Aucun format de date numérique n'existe : en ajouter un rouvrirait la
    // porte à l'ambiguïté (tests/i18n.test.ts scrute le code source pour
    // l'empêcher).
    //
    // N'AFFICHER une date que par lib/i18n/valeurs.ts : le français écrit
    // « 1er octobre », ce qu'Intl ne sait pas faire.
    dateJuridique: { day: "numeric", month: "long", year: "numeric" },
    // Forme abrégée pour les tableaux denses (« 1 oct. 2026 ») : le mois
    // reste en lettres, jamais en chiffres.
    dateJuridiqueCourte: { day: "numeric", month: "short", year: "numeric" },
    // Avec l'heure : pour un événement daté (une modification du journal). Le mois
    // reste en lettres. Fuseau UTC, comme partout (voir FUSEAU).
    dateHeure: {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  },
} satisfies Formats;

// Les dates du schéma sont des dates de calendrier (`date`) ou des instants
// UTC : les afficher dans le fuseau du serveur ou du navigateur décalerait
// un jour selon l'endroit où on les lit.
export const FUSEAU = "UTC";
