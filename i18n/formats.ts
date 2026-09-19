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
    date: { day: "2-digit", month: "2-digit", year: "numeric" },
  },
} satisfies Formats;

// Les dates du schéma sont des dates de calendrier (`date`) ou des instants
// UTC : les afficher dans le fuseau du serveur ou du navigateur décalerait
// un jour selon l'endroit où on les lit.
export const FUSEAU = "UTC";
