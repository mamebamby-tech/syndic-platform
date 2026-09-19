"use server";

import { revalidatePath } from "next/cache";
import { creerClientServeur } from "@/lib/supabase/server";
import {
  chargerParametres,
  peutParametrer,
  roleSurOrganisation,
} from "@/lib/data/parametres-immeuble";
import type { EtatFormulaire } from "@/lib/parametres/etat";
import { validerParametres } from "@/lib/parametres/validation";

const texte = (formData: FormData, nom: string) => String(formData.get(nom) ?? "");

// Enregistre les paramètres de paiement et de référence d'un immeuble.
//
// La sécurité ne repose PAS sur ce fichier : la sécurité par ligne refuse la
// modification à un lecteur, et les déclencheurs de la base tracent chaque
// changement de coordonnées (journal) et posent la date. Ce qui suit donne des
// messages précis et évite un aller-retour inutile.
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
  const { data, error } = await supabase
    .from("immeubles")
    .update(valeurs)
    .eq("id", immeubleId)
    .select("id");

  if (error) {
    if (error.code === "23505") {
      return { statut: "erreur", erreurs: { codeReference: "code_deja_utilise" } };
    }
    if (error.code === "23514") {
      // Contrainte de la base que la validation locale n'a pas vue : on la nomme.
      if (error.message.includes("immeubles_swift_requis")) return { statut: "erreur", erreurs: { bic: "swift_requis" } };
      if (error.message.includes("immeubles_bic_format")) return { statut: "erreur", erreurs: { bic: "bic_invalide" } };
      if (error.message.includes("immeubles_format_reference_valide")) return { statut: "erreur", erreurs: { formatReference: "format_invalide" } };
      if (error.message.includes("immeubles_code_reference_format")) return { statut: "erreur", erreurs: { codeReference: "code_invalide" } };
    }
    return { statut: "erreur", erreurs: { general: "enregistrement_impossible" } };
  }

  // Aucune ligne touchée et aucune erreur : la sécurité par ligne a refusé.
  if (!data || data.length === 0) {
    return { statut: "erreur", erreurs: { general: "acces_refuse" } };
  }

  revalidatePath(`/immeubles/${immeubleId}`, "layout");
  return { statut: "ok", erreurs: {} };
}
