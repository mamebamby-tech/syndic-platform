"use server";

import { revalidatePath } from "next/cache";
import { creerClientServeur } from "@/lib/supabase/server";
import {
  erreurDeLaBase,
  validerAnnulation,
  validerPaiement,
  type EtatPaiement,
} from "@/lib/paiements/validation";

const texte = (formData: FormData, nom: string) => String(formData.get(nom) ?? "");

// Date du jour (AAAA-MM-JJ), la même que celle que la base compare (`current_date`,
// fuseau UTC).
const aujourdhui = () => new Date().toISOString().slice(0, 10);

function rafraichir(formData: FormData) {
  const immeubleId = texte(formData, "immeubleId");
  const proprietaireId = texte(formData, "proprietaireId");
  if (immeubleId && proprietaireId) {
    revalidatePath(`/immeubles/${immeubleId}/proprietaires/${proprietaireId}`);
  }
  if (immeubleId) revalidatePath(`/immeubles/${immeubleId}/appels`);
}

// Enregistre un paiement saisi à la main, sur un appel émis.
//
// La sécurité ne repose PAS sur ce fichier : l'utilisateur n'a pas le droit d'écrire dans
// `paiements`. Seule la fonction de la base le fait, après avoir vérifié qu'il est
// gestionnaire ou proprietaire_org de l'immeuble de l'appel, que l'appel est payable et
// que le paiement ne dépasse pas le reste dû.
export async function enregistrerPaiement(_precedent: EtatPaiement, formData: FormData): Promise<EtatPaiement> {
  const { valeurs, erreurs } = validerPaiement(
    {
      appelId: texte(formData, "appelId"),
      montant: texte(formData, "montant"),
      moyen: texte(formData, "moyen"),
      date: texte(formData, "date"),
      reference: texte(formData, "reference"),
    },
    aujourdhui(),
  );
  if (!valeurs) return { statut: "erreur", erreurs };

  const supabase = await creerClientServeur();
  const { error } = await supabase.rpc("enregistrer_paiement", {
    p_appel: valeurs.appelId,
    p_montant: valeurs.montant,
    p_moyen: valeurs.moyen,
    p_date: valeurs.date,
    p_reference_externe: valeurs.reference,
  });
  if (error) return { statut: "erreur", erreurs: erreurDeLaBase(error) };

  rafraichir(formData);
  return { statut: "ok", erreurs: {} };
}

// Annule un paiement par une écriture inverse. Le paiement d'origine n'est jamais modifié.
export async function annulerPaiement(_precedent: EtatPaiement, formData: FormData): Promise<EtatPaiement> {
  const { valeurs, erreurs } = validerAnnulation({
    paiementId: texte(formData, "paiementId"),
    motif: texte(formData, "motif"),
  });
  if (!valeurs) return { statut: "erreur", erreurs };

  const supabase = await creerClientServeur();
  const { error } = await supabase.rpc("annuler_paiement", {
    p_paiement: valeurs.paiementId,
    p_motif: valeurs.motif,
  });
  if (error) return { statut: "erreur", erreurs: erreurDeLaBase(error) };

  rafraichir(formData);
  return { statut: "ok", erreurs: {} };
}
