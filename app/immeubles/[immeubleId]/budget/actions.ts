"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { creerClientServeur } from "@/lib/supabase/server";

// Écrit les lignes du budget. Partagé par « Enregistrer » et « Enregistrer et
// générer » : les deux enregistrent exactement de la même façon. La base refuse
// tout changement si des appels de la période sont émis (budget verrouillé).
async function ecrireBudget(formData: FormData) {
  const periodeId = String(formData.get("periodeId") ?? "");
  const immeubleId = String(formData.get("immeubleId") ?? "");
  const posteIds = String(formData.get("posteIds") ?? "")
    .split(",")
    .filter((id) => id.length > 0);

  if (!periodeId || posteIds.length === 0) {
    throw new Error("Formulaire de budget incomplet.");
  }

  const supabase = await creerClientServeur();

  const lignes = posteIds.map((posteId) => {
    const montantBrut = Number(formData.get(`montant:${posteId}`) ?? 0);
    const montant = Number.isFinite(montantBrut) ? Math.max(0, Math.round(montantBrut)) : 0;
    const fournisseurBrut = String(formData.get(`fournisseur:${posteId}`) ?? "").trim();

    return {
      periode_id: periodeId,
      poste_charge_id: posteId,
      montant,
      fournisseur: fournisseurBrut.length > 0 ? fournisseurBrut : null,
    };
  });

  const { error } = await supabase
    .from("budget_lignes")
    .upsert(lignes, { onConflict: "periode_id,poste_charge_id" });

  if (error) {
    throw new Error(`Enregistrement du budget impossible : ${error.message}`);
  }
}

export async function enregistrerBudget(formData: FormData) {
  await ecrireBudget(formData);
  revalidatePath(`/immeubles/${String(formData.get("immeubleId") ?? "")}/budget`);
}

export async function changerCleRepartition(formData: FormData) {
  const immeubleId = String(formData.get("immeubleId") ?? "");
  const posteId = String(formData.get("posteId") ?? "");
  const cleRepartitionId = String(formData.get("cleRepartitionId") ?? "");

  if (!immeubleId || !posteId || !cleRepartitionId) {
    throw new Error("Changement de clé de répartition incomplet.");
  }

  const supabase = await creerClientServeur();
  const { error } = await supabase
    .from("postes_charges")
    .update({ cle_repartition_id: cleRepartitionId })
    .eq("id", posteId);

  if (error) {
    throw new Error(`Changement de clé de répartition impossible : ${error.message}`);
  }

  revalidatePath(`/immeubles/${immeubleId}/budget`);
}

// Génère les appels de la période depuis le budget ENREGISTRÉ. Ne lit jamais les
// champs de la page : générer avec un budget non enregistré appellerait des
// montants que personne n'a validés (l'écran désactive alors le bouton).
async function genererDepuisLeBudget(formData: FormData) {
  const immeubleId = String(formData.get("immeubleId") ?? "");
  const periodeId = String(formData.get("periodeId") ?? "");

  if (!immeubleId || !periodeId) {
    throw new Error("Génération des appels : période introuvable.");
  }

  const supabase = await creerClientServeur();
  const { data, error } = await supabase.rpc("generer_appels", {
    p_periode_id: periodeId,
  });

  if (error) {
    throw new Error(`Génération des appels impossible : ${error.message}`);
  }

  revalidatePath(`/immeubles/${immeubleId}/budget`);
  redirect(`/immeubles/${immeubleId}/appels?generes=${data ?? 0}`);
}

export async function genererAppels(formData: FormData) {
  await genererDepuisLeBudget(formData);
}

// Action unique : enregistre le budget puis génère les appels. Si l'enregistrement
// échoue (budget verrouillé, par exemple), rien n'est généré.
export async function enregistrerEtGenererAppels(formData: FormData) {
  await ecrireBudget(formData);
  await genererDepuisLeBudget(formData);
}
