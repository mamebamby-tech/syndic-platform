import type { ErreursParametres, CodeErreur } from "@/lib/parametres/validation";

// État renvoyé par l'action serveur au formulaire. Hors du fichier « use
// server », qui ne peut exporter que des fonctions asynchrones.
export interface EtatFormulaire {
  statut: "initial" | "ok" | "erreur";
  erreurs: ErreursParametres & { general?: CodeErreur };
}

export const ETAT_INITIAL: EtatFormulaire = { statut: "initial", erreurs: {} };
