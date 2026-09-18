"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { creerClientServeur } from "@/lib/supabase/server";

export async function enregistrerBudget(formData: FormData) {
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

  revalidatePath(`/immeubles/${immeubleId}/budget`);
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

export async function genererAppels(formData: FormData) {
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
