import type { Formats } from "next-intl";

// Formats nommés, partagés par l'interface, les documents et les gabarits
// de notification. Un seul endroit : ce que la locale change (séparateurs,
// ordre jour/mois), pas ce que le format signifie.
//
// La devise est XOF dans toutes les langues, affichée par son code ISO :
// aucune conversion, aucun symbole traduit (« F CFA » en français, « CFA »
// en anglais prêteraient à confusion dans un document de comptabilité).
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
    // C'est volontairement le seul format de date : ajouter une variante
    // numérique rouvrirait la porte à l'ambiguïté (tests/i18n.test.ts scrute
    // le code source pour l'empêcher).
    dateJuridique: { day: "numeric", month: "long", year: "numeric" },
  },
} satisfies Formats;

// Les dates du schéma sont des dates de calendrier (`date`) ou des instants
// UTC : les afficher dans le fuseau du serveur ou du navigateur décalerait
// un jour selon l'endroit où on les lit.
export const FUSEAU = "UTC";
