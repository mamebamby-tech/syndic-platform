// Langues que l'application sait servir. Ce n'est pas une règle juridique
// (CLAUDE.md règle n°1) : c'est le périmètre de traduction du produit.
// `membres.langue` et `proprietaires.langue` n'imposent aucune liste côté
// base ; toute valeur absente d'ici retombe sur LANGUE_PAR_DEFAUT.
export const LANGUES = ["fr", "en"] as const;
export type Langue = (typeof LANGUES)[number];

export const LANGUE_PAR_DEFAUT: Langue = "fr";

// Locale de FORMATAGE (nombres, dates) de chaque langue. Le code de langue
// (`membres.langue`, `messages/<code>.json`) reste sur deux lettres ; la
// locale, elle, porte la région quand elle change ce qu'on lit :
// l'anglais sans région formaterait les dates à l'américaine, et un
// `10/01/2026` se lit le 10 janvier en Amérique, le 1er octobre partout
// ailleurs. L'anglais est donc l'anglais britannique.
export const LOCALES = { fr: "fr", en: "en-GB" } as const satisfies Record<Langue, string>;
export type Locale = (typeof LOCALES)[Langue];

export function localeDe(langue: Langue): Locale {
  return LOCALES[langue];
}

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
