// Lecture d'une ligne de `journal` pour les paramètres de l'immeuble : ce qui a
// changé, par qui, quand — sans jamais réafficher un numéro de compte en clair.
//
// Le journal (avant / après) garde les valeurs COMPLÈTES, pour l'audit ; l'écran
// les masque : le tableau de bord est lu par tout le personnel, lecteurs compris.

export const ACTIONS_PAIEMENT = ["coordonnees_paiement_modifiees"] as const;
export const ACTIONS_PARAMETRES = ["coordonnees_paiement_modifiees", "format_reference_modifie"] as const;
export type ActionJournal = (typeof ACTIONS_PARAMETRES)[number];

export interface LigneJournal {
  id: string;
  cree_le: string;
  acteur_libelle: string | null;
  action: string;
  avant: unknown;
  apres: unknown;
}

export type Changement =
  | {
      champ: "compte_titulaire" | "compte_banque" | "compte_bic" | "code_reference" | "format_reference_appel";
      nature: "texte";
      avant: string | null;
      apres: string | null;
    }
  // Numéro de compte : masqué (quatre derniers caractères).
  | { champ: "compte_numero"; nature: "secret"; avant: string | null; apres: string | null }
  | { champ: "moyens_paiement_acceptes"; nature: "moyens"; avant: string[]; apres: string[] }
  // Numéros marchands : masqués eux aussi.
  | {
      champ: "numeros_marchands";
      nature: "marchands";
      avant: Record<string, string>;
      apres: Record<string, string>;
    };

export interface ModificationDecrite {
  id: string;
  date: string;
  // Courriel ou numéro de l'auteur au moment de l'action ; null si inconnu
  // (modification hors session : script, migration).
  acteur: string | null;
  action: ActionJournal;
  // Première saisie : rien n'était renseigné avant.
  premiereSaisie: boolean;
  changements: Changement[];
}

// « •••• 1234 » : on reconnaît le compte sans pouvoir le recopier.
export function masquer(valeur: string | null): string | null {
  if (valeur === null) return null;
  const sansEspaces = valeur.replace(/\s+/g, "");
  return sansEspaces.length > 4 ? `•••• ${sansEspaces.slice(-4)}` : "••••";
}

const objet = (valeur: unknown): Record<string, unknown> =>
  valeur !== null && typeof valeur === "object" && !Array.isArray(valeur)
    ? (valeur as Record<string, unknown>)
    : {};
const texte = (valeur: unknown): string | null =>
  typeof valeur === "string" && valeur.length > 0 ? valeur : null;
const liste = (valeur: unknown): string[] =>
  Array.isArray(valeur) ? valeur.filter((v): v is string => typeof v === "string") : [];
const masques = (valeur: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(objet(valeur)).map(([moyen, numero]) => [moyen, masquer(texte(numero)) ?? "••••"]),
  );

const memes = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function decrireModification(ligne: LigneJournal): ModificationDecrite | null {
  if (!(ACTIONS_PARAMETRES as readonly string[]).includes(ligne.action)) return null;

  const avant = objet(ligne.avant);
  const apres = objet(ligne.apres);
  const changements: Changement[] = [];

  const texteChange = (
    champ: Extract<Changement, { nature: "texte" }>["champ"],
  ) => {
    if (!memes(texte(avant[champ]), texte(apres[champ]))) {
      changements.push({ champ, nature: "texte", avant: texte(avant[champ]), apres: texte(apres[champ]) });
    }
  };

  if (ligne.action === "coordonnees_paiement_modifiees") {
    texteChange("compte_titulaire");
    texteChange("compte_banque");
    if (!memes(texte(avant.compte_numero), texte(apres.compte_numero))) {
      changements.push({
        champ: "compte_numero",
        nature: "secret",
        avant: masquer(texte(avant.compte_numero)),
        apres: masquer(texte(apres.compte_numero)),
      });
    }
    texteChange("compte_bic");
    if (!memes(liste(avant.moyens_paiement_acceptes), liste(apres.moyens_paiement_acceptes))) {
      changements.push({
        champ: "moyens_paiement_acceptes",
        nature: "moyens",
        avant: liste(avant.moyens_paiement_acceptes),
        apres: liste(apres.moyens_paiement_acceptes),
      });
    }
    if (!memes(objet(avant.numeros_marchands), objet(apres.numeros_marchands))) {
      changements.push({
        champ: "numeros_marchands",
        nature: "marchands",
        avant: masques(avant.numeros_marchands),
        apres: masques(apres.numeros_marchands),
      });
    }
  } else {
    texteChange("code_reference");
    texteChange("format_reference_appel");
  }

  const avantVide =
    ligne.avant === null ||
    (texte(avant.compte_titulaire) === null &&
      texte(avant.compte_banque) === null &&
      texte(avant.compte_numero) === null &&
      liste(avant.moyens_paiement_acceptes).length === 0);

  return {
    id: ligne.id,
    date: ligne.cree_le,
    acteur: ligne.acteur_libelle,
    action: ligne.action as ActionJournal,
    premiereSaisie: ligne.action === "coordonnees_paiement_modifiees" && avantVide,
    changements,
  };
}
