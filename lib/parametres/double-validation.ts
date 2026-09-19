// Double validation des coordonnées de paiement : ce que l'écran doit dire de la
// situation d'une modification en attente. La règle elle-même vit en base
// (20260919140000) : ici, seulement ce qu'il faut pour ne pas montrer un bouton
// qui échouerait, et pour signaler ce qui bloque.

export interface SituationVersion {
  // L'utilisateur courant a proposé cette modification : il ne peut pas la confirmer.
  estAuteur: boolean;
  // Il peut la confirmer ou la refuser : habilité (page réservée) et pas l'auteur.
  peutConfirmer: boolean;
  // Il n'y a pas d'autre membre habilité que l'auteur : PERSONNE ne peut confirmer.
  // La règle n'est pas contournée ; c'est une décision à prendre (ajouter un membre).
  aucunAutreHabilite: boolean;
}

// « Habilité » : gestionnaire ou proprietaire_org — mêmes rôles que
// app.est_gestionnaire, qui décide en base.
export const ROLES_HABILITES = ["gestionnaire", "proprietaire_org"] as const;

export function compterHabilites(roles: readonly string[]): number {
  return roles.filter((role) => (ROLES_HABILITES as readonly string[]).includes(role)).length;
}

export function situationDeLaVersion(
  proposePar: string | null,
  utilisateurId: string | null,
  nombreHabilites: number,
): SituationVersion {
  // Auteur inconnu (compte supprimé) : personne n'est l'auteur, tout habilité peut confirmer.
  const estAuteur = proposePar !== null && utilisateurId !== null && proposePar === utilisateurId;
  return {
    estAuteur,
    peutConfirmer: !estAuteur,
    aucunAutreHabilite: nombreHabilites < 2,
  };
}

// Forme du journal (avant / après) pour un jeu de coordonnées : sert à décrire une
// modification en attente avec le même vocabulaire que les entrées du journal.
export interface JeuCoordonnees {
  titulaire: string;
  banque: string;
  numero: string;
  bic: string;
  moyens: readonly string[];
  marchands: Record<string, string>;
}

const nul = (valeur: string) => (valeur.trim().length > 0 ? valeur.trim() : null);

export function instantaneCoordonnees(jeu: JeuCoordonnees) {
  return {
    compte_titulaire: nul(jeu.titulaire),
    compte_banque: nul(jeu.banque),
    compte_numero: nul(jeu.numero),
    compte_bic: nul(jeu.bic),
    moyens_paiement_acceptes: [...jeu.moyens],
    numeros_marchands: jeu.marchands,
  };
}

// Deux jeux sont identiques quand la base dirait « aucun changement » : chaînes
// normalisées (vide = absent), moyens dans le même ordre canonique.
export function memesCoordonnees(a: JeuCoordonnees, b: JeuCoordonnees): boolean {
  const cle = (jeu: JeuCoordonnees) =>
    JSON.stringify({
      ...instantaneCoordonnees(jeu),
      moyens_paiement_acceptes: [...jeu.moyens].sort(),
      numeros_marchands: Object.fromEntries(Object.entries(jeu.marchands).sort(([x], [y]) => x.localeCompare(y))),
    });
  return cle(a) === cle(b);
}
