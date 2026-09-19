import type { ErreursParametres, CodeErreur } from "@/lib/parametres/validation";

// État renvoyé par l'action serveur au formulaire. Hors du fichier « use
// server », qui ne peut exporter que des fonctions asynchrones.
export interface EtatFormulaire {
  // en_attente : une modification des coordonnées de paiement a été PROPOSÉE ; elle
  // n'est pas en vigueur tant qu'un autre membre habilité ne l'a pas confirmée.
  statut: "initial" | "ok" | "en_attente" | "erreur";
  erreurs: ErreursParametres & { general?: CodeErreur };
}

export const ETAT_INITIAL: EtatFormulaire = { statut: "initial", erreurs: {} };
