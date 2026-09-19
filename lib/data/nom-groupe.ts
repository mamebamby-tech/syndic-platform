// Le nom d'un groupe dans la base porte souvent déjà le mot (« SCI ALIZE
// (groupe) »), et l'écran ajoute « groupe » devant : « groupe SCI ALIZE
// (groupe) ». On retire la mention de la donnée pour ne l'afficher qu'une fois,
// devant, où la langue de l'écran la met en mots. Le nom stocké n'est jamais
// modifié : c'est un affichage.
export function sansMentionGroupe(nom: string): string {
  return nom.replace(/\s*\((?:groupe|group)\)\s*$/i, "").trim() || nom;
}
