// Nom du produit : Coprane (décision 68). Vit dans cette seule constante, jamais
// en dur ailleurs (CLAUDE.md règle n°6) — le renommer reste une modification
// d'une ligne. Il apparaît dans l'application et dans le pied de page du PDF des
// appels (« Document édité avec Coprane »). Il n'est PAS l'expéditeur des
// courriels : ceux-ci partent au nom du cabinet (`organisations.nom`), Coprane
// n'étant qu'un repli si ce nom manque (lib/courriel/expediteur.ts).
export const nom = "Coprane";
export const nomCourt = "Coprane";
export const baseline = "Gestion de copropriété";
