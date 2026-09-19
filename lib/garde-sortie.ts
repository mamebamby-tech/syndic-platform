// Garde de sortie : prévenir avant de quitter une page qui porte des modifications
// non enregistrées. Un module unique côté navigateur, partagé par les composants
// qui savent qu'il y en a (le formulaire du budget) et ceux qui font naviguer
// (le sélecteur d'immeuble, dont le changement passe par router.push et échappe
// donc à la fois à `beforeunload` et aux clics sur un lien).
//
// Limite connue : le bouton « précédent » du navigateur n'est pas intercepté dans
// une navigation interne (l'App Router ne l'expose pas). La fermeture de l'onglet
// et le rechargement le sont (beforeunload), ainsi que les liens et le sélecteur.

let modificationsNonEnregistrees = false;

export function definirModificationsNonEnregistrees(valeur: boolean): void {
  modificationsNonEnregistrees = valeur;
}

// Vrai si l'on peut quitter : rien à perdre, ou l'utilisateur a confirmé.
export function confirmerSortie(message: string): boolean {
  return !modificationsNonEnregistrees || window.confirm(message);
}
