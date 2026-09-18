// Formatage partagé : montants XOF sans décimale, dates en français.
// CLAUDE.md règle n°3 : les montants s'affichent sans décimale.

export function formaterXof(montant: number): string {
  return `${montant.toLocaleString("fr-FR")} XOF`;
}

export function formaterNombre(valeur: number): string {
  return valeur.toLocaleString("fr-FR");
}

export function formaterDate(date: string): string {
  return new Date(date).toLocaleDateString("fr-FR");
}
