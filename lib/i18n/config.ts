// Langues que l'application sait servir. Ce n'est pas une règle juridique
// (CLAUDE.md règle n°1) : c'est le périmètre de traduction du produit.
// `membres.langue` et `proprietaires.langue` n'imposent aucune liste côté
// base ; toute valeur absente d'ici retombe sur LANGUE_PAR_DEFAUT.
export const LANGUES = ["fr", "en"] as const;
export type Langue = (typeof LANGUES)[number];

export const LANGUE_PAR_DEFAUT: Langue = "fr";

// Langue de la seule version opposable des documents juridiques (appel de
// cotisation, convocation, procès-verbal). Indépendante de la langue de la
// personne qui les consulte : voir lib/i18n/document.ts.
export const LANGUE_OPPOSABLE: Langue = "fr";

export function estLangue(valeur: unknown): valeur is Langue {
  return LANGUES.some((langue) => langue === valeur);
}

export function normaliserLangue(valeur: unknown): Langue {
  return estLangue(valeur) ? valeur : LANGUE_PAR_DEFAUT;
}
