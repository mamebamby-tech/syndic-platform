import type { Periodicite } from "@/lib/types/database";

// Référence d'un appel : `MT-2026T4-007`. Miroir TypeScript de ce que fait la
// base (20260919080000_reference_appel.sql) : sert à valider un gabarit et à
// en montrer un exemple AVANT de l'enregistrer. La base reste l'autorité — ses
// contraintes refusent un gabarit invalide même si ce module se trompait, et
// tests/parametres-immeuble.test.ts compare les deux implémentations.

export const JETONS_REFERENCE = ["code", "annee", "periode", "seq"] as const;

const JETON = /\{(code|annee|periode|seq)\}/g;

// Code court de l'immeuble : préfixe de toutes ses références.
export function codeReferenceValide(code: string): boolean {
  return /^[A-Z0-9]{1,8}$/.test(code);
}

// `{seq}` obligatoire (c'est lui qui rend la référence unique) ; hors jetons,
// uniquement des caractères dictables — jamais d'espace.
export function formatReferenceValide(format: string): boolean {
  return format.includes("{seq}") && /^[A-Za-z0-9_-]*$/.test(format.replace(JETON, ""));
}

// Code de présentation de la période (T4, M10, S2, A), pas une règle
// juridique : mêmes lettres que app.code_periode.
export function codePeriode(periodicite: Periodicite, mois: number): string {
  switch (periodicite) {
    case "mensuel":
      return `M${String(mois).padStart(2, "0")}`;
    case "trimestriel":
      return `T${Math.floor((mois - 1) / 3) + 1}`;
    case "semestriel":
      return `S${Math.floor((mois - 1) / 6) + 1}`;
    case "annuel":
      return "A";
  }
}

export interface ElementsReference {
  code: string;
  annee: number;
  periode: string;
  seq: number;
}

export function rendreReference(format: string, elements: ElementsReference): string {
  return format
    .replaceAll("{code}", elements.code)
    .replaceAll("{annee}", String(elements.annee))
    .replaceAll("{periode}", elements.periode)
    .replaceAll("{seq}", String(elements.seq).padStart(3, "0"));
}
