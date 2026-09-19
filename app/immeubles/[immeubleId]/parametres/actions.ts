"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { creerClientServeur } from "@/lib/supabase/server";
import {
  chargerParametres,
  peutParametrer,
  roleSurOrganisation,
} from "@/lib/data/parametres-immeuble";
import type { EtatFormulaire } from "@/lib/parametres/etat";
import { memesCoordonnees } from "@/lib/parametres/double-validation";
import { validerParametres } from "@/lib/parametres/validation";

const texte = (formData: FormData, nom: string) => String(formData.get(nom) ?? "");

// Enregistre les paramètres d'un immeuble.
//
// - Code et format de la référence : modification directe.
// - Coordonnées de paiement (compte, moyens, numéros marchands) : elles ne se
//   modifient PAS directement — les utilisateurs n'ont plus le droit d'écrire ces
//   colonnes. On PROPOSE une version, qui n'entre en vigueur qu'après
//   confirmation par un autre membre habilité que l'auteur.
//
// La sécurité ne repose PAS sur ce fichier : sécurité par ligne, droits de colonne,
// fonctions et déclencheurs de la base. Ce qui suit donne des messages précis.
export async function enregistrerParametres(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const immeubleId = texte(formData, "immeubleId");
  if (!immeubleId) return { statut: "erreur", erreurs: { general: "enregistrement_impossible" } };

  const courants = await chargerParametres(immeubleId);
  if (!courants) return { statut: "erreur", erreurs: { general: "acces_refuse" } };
  if (!peutParametrer(await roleSurOrganisation(courants.organisationId))) {
    return { statut: "erreur", erreurs: { general: "acces_refuse" } };
  }

  const { valeurs, erreurs } = validerParametres({
    titulaire: texte(formData, "titulaire"),
    banque: texte(formData, "banque"),
    numero: texte(formData, "numero"),
    bic: texte(formData, "bic"),
    moyens: formData.getAll("moyens").map(String),
    marchands: {
      wave: texte(formData, "marchand_wave"),
      orange_money: texte(formData, "marchand_orange_money"),
    },
    codeReference: texte(formData, "codeReference"),
    formatReference: texte(formData, "formatReference"),
  });
  if (!valeurs) return { statut: "erreur", erreurs };

  const supabase = await creerClientServeur();

  // 1. Référence : modification directe, seulement si elle change.
  const referenceChangee =
    valeurs.code_reference !== courants.codeReference ||
    valeurs.format_reference_appel !== courants.formatReference;
  if (referenceChangee) {
    const { data, error } = await supabase
      .from("immeubles")
      .update({
        code_reference: valeurs.code_reference,
        format_reference_appel: valeurs.format_reference_appel,
      })
      .eq("id", immeubleId)
      .select("id");

    if (error) {
      if (error.code === "23505") return { statut: "erreur", erreurs: { codeReference: "code_deja_utilise" } };
      if (error.code === "23514") {
        if (error.message.includes("immeubles_format_reference_valide")) return { statut: "erreur", erreurs: { formatReference: "format_invalide" } };
        if (error.message.includes("immeubles_code_reference_format")) return { statut: "erreur", erreurs: { codeReference: "code_invalide" } };
      }
      return { statut: "erreur", erreurs: { general: "enregistrement_impossible" } };
    }
    // Aucune ligne touchée et aucune erreur : la sécurité par ligne a refusé.
    if (!data || data.length === 0) return { statut: "erreur", erreurs: { general: "acces_refuse" } };
  }

  // 2. Coordonnées de paiement : proposition, si elles diffèrent de celles en vigueur.
  const enVigueur = {
    titulaire: courants.titulaire,
    banque: courants.banque,
    numero: courants.numero,
    bic: courants.bic,
    moyens: courants.moyens,
    marchands: courants.marchands,
  };
  const propose = {
    titulaire: valeurs.compte_titulaire ?? "",
    banque: valeurs.compte_banque ?? "",
    numero: valeurs.compte_numero ?? "",
    bic: valeurs.compte_bic ?? "",
    moyens: valeurs.moyens_paiement_acceptes,
    marchands: valeurs.numeros_marchands as Record<string, string>,
  };
  const paiementChange = !memesCoordonnees(enVigueur, propose);

  if (paiementChange) {
    const { error } = await supabase.rpc("proposer_coordonnees_paiement", {
      p_immeuble: immeubleId,
      p_titulaire: valeurs.compte_titulaire,
      p_banque: valeurs.compte_banque,
      p_numero: valeurs.compte_numero,
      p_bic: valeurs.compte_bic,
      p_moyens: valeurs.moyens_paiement_acceptes,
      p_numeros: propose.marchands,
    });
    if (error) {
      if (error.code === "42501") return { statut: "erreur", erreurs: { general: "acces_refuse" } };
      if (error.code === "23514") {
        if (error.message.includes("versions_swift_requis")) return { statut: "erreur", erreurs: { bic: "swift_requis" } };
        if (error.message.includes("versions_bic_format")) return { statut: "erreur", erreurs: { bic: "bic_invalide" } };
      }
      // 22023 « aucun changement » : ne devrait pas arriver (comparé plus haut) ; sans effet.
      if (error.code !== "22023") return { statut: "erreur", erreurs: { general: "enregistrement_impossible" } };
    }
  }

  revalidatePath(`/immeubles/${immeubleId}`, "layout");
  return { statut: paiementChange ? "en_attente" : "ok", erreurs: {} };
}

// Décision sur la modification en attente. Formulaires (pas d'état à renvoyer) :
// on revient sur la page avec le résultat en paramètre.
type Decision = "confirmee" | "refusee" | "auteur" | "plus_en_attente" | "non_autorise" | "erreur";

function decisionDepuisErreur(erreur: { code?: string; message: string }): Decision {
  if (erreur.code === "42501") return erreur.message.includes("auteur") ? "auteur" : "non_autorise";
  if (erreur.code === "22023") return "plus_en_attente";
  return "erreur";
}

async function decider(formData: FormData, fonction: "confirmer_coordonnees_paiement" | "refuser_coordonnees_paiement") {
  const immeubleId = texte(formData, "immeubleId");
  const versionId = texte(formData, "versionId");
  if (!immeubleId || !versionId) redirect(`/immeubles/${immeubleId}/parametres?decision=erreur`);

  const supabase = await creerClientServeur();
  const { error } = await supabase.rpc(fonction, { p_version: versionId });
  const decision: Decision = error
    ? decisionDepuisErreur(error)
    : fonction === "confirmer_coordonnees_paiement"
      ? "confirmee"
      : "refusee";

  revalidatePath(`/immeubles/${immeubleId}`, "layout");
  redirect(`/immeubles/${immeubleId}/parametres?decision=${decision}`);
}

export async function confirmerModification(formData: FormData) {
  await decider(formData, "confirmer_coordonnees_paiement");
}

export async function refuserModification(formData: FormData) {
  await decider(formData, "refuser_coordonnees_paiement");
}
