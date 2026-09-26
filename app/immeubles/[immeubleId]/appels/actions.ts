"use server";

import { revalidatePath } from "next/cache";
import { creerClientServeur } from "@/lib/supabase/server";
import { trouverPeriodeDeTravail } from "@/lib/data/periodes";
import { peutParametrer, roleSurOrganisation } from "@/lib/data/parametres-immeuble";
import { engendrerDocumentAppel, lireDocumentAppel } from "@/lib/appels/document-pdf";
import { lireInstantane } from "@/lib/appels/instantane";
import { envoyerAppels, recapituler, type BilanEnvoi } from "@/lib/appels/envoi";
import { chargerAppelsAEnvoyer } from "@/lib/data/envoi-appels";
import { configurationCourriel } from "@/lib/courriel/configuration";
import { EnvoiInterdit } from "@/lib/courriel/garde-fou";
import { formaterExpediteur } from "@/lib/courriel/expediteur";
import { enDemonstration } from "@/lib/demonstration";

// Émission et envoi des appels (décisions 69 et 70). Les droits sont vérifiés
// ici pour répondre clairement, mais l'autorité reste la base : émission
// (app.figer_appel), dépôt du PDF (politiques du seau, enregistrer_document_appel)
// et trace (tracer_envoi_appel) refusent tout ce qui n'est pas un habilité.

async function exigerHabilite(immeubleId: string) {
  const supabase = await creerClientServeur();
  const { data: immeuble } = await supabase.from("immeubles").select("organisation_id").eq("id", immeubleId).maybeSingle();
  if (!immeuble || !peutParametrer(await roleSurOrganisation(immeuble.organisation_id))) {
    throw new Error("Réservé au gestionnaire et au propriétaire du cabinet.");
  }
  return supabase;
}

export interface ResultatEmission {
  emis: number;
  pdf: number;
  erreurs: string[];
}

// Émet les brouillons de la période de travail, puis engendre le PDF de chacun.
// Un PDF qui échoue n'annule pas l'émission (l'appel est figé) : il reste à
// engendrer, depuis le même instantané, par « Engendrer les PDF manquants ».
export async function emettreBrouillons(immeubleId: string): Promise<ResultatEmission> {
  const supabase = await exigerHabilite(immeubleId);
  const periode = await trouverPeriodeDeTravail(immeubleId);
  if (!periode) return { emis: 0, pdf: 0, erreurs: [] };

  const { data, error } = await supabase
    .from("appels")
    .update({ statut: "emis" })
    .eq("periode_id", periode.id)
    .eq("statut", "brouillon")
    .select("id");
  if (error) return { emis: 0, pdf: 0, erreurs: [error.message] };

  const resultat = await engendrerTous(supabase, (data ?? []).map((a) => a.id));
  revalidatePath(`/immeubles/${immeubleId}/appels`);
  return { emis: (data ?? []).length, ...resultat };
}

export async function engendrerPdfManquants(immeubleId: string): Promise<ResultatEmission> {
  const supabase = await exigerHabilite(immeubleId);
  const { sansPdf } = await chargerAppelsAEnvoyer(immeubleId);
  const resultat = await engendrerTous(supabase, sansPdf);
  revalidatePath(`/immeubles/${immeubleId}/appels`);
  return { emis: 0, ...resultat };
}

async function engendrerTous(supabase: Awaited<ReturnType<typeof creerClientServeur>>, ids: string[]) {
  let pdf = 0;
  const erreurs: string[] = [];
  for (const id of ids) {
    try {
      await engendrerDocumentAppel(supabase, id);
      pdf += 1;
    } catch (erreur) {
      erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }
  return { pdf, erreurs };
}

export type EtatEnvoiAppels =
  | { etat: "initial" }
  // `detail` : le texte de la règle qui a refusé (garde-fou), pour le gestionnaire.
  | { etat: "refuse"; motif: "non_habilite" | "non_configure" | "garde_fou"; detail?: string }
  | { etat: "termine"; bilan: BilanEnvoi; demonstration: boolean };

export async function envoyerLesAppels(_precedent: EtatEnvoiAppels, formData: FormData): Promise<EtatEnvoiAppels> {
  const immeubleId = String(formData.get("immeubleId") ?? "");
  let supabase: Awaited<ReturnType<typeof creerClientServeur>>;
  try {
    supabase = await exigerHabilite(immeubleId);
  } catch {
    return { etat: "refuse", motif: "non_habilite" };
  }

  const configuration = configurationCourriel();
  if (!configuration) {
    return { etat: "refuse", motif: "non_configure" };
  }

  // Recalculé ici, jamais repris du navigateur : c'est ce récapitulatif-là qui part.
  const donnees = await chargerAppelsAEnvoyer(immeubleId);
  const demonstration = enDemonstration();
  const pause = () => new Promise<void>((resoudre) => setTimeout(resoudre, 600));

  try {
    const bilan = await envoyerAppels(
      recapituler(donnees.appels),
      {
        recapitulatifValide: formData.get("recapitulatifValide") === "oui",
        renvoyerDejaEnvoyes: formData.get("renvoyerDejaEnvoyes") === "oui",
        demonstration,
        redirection: demonstration ? String(formData.get("redirection") ?? "") : null,
        expediteur: formaterExpediteur(donnees.nomCabinet, configuration.adresse),
        adresseCabinet: donnees.adresseCabinet,
      },
      {
        transport: configuration.transport,
        pause,
        instantane: async (appelId) => {
          const { data, error } = await supabase.from("appels").select("instantane").eq("id", appelId).single();
          if (error) throw new Error(error.message);
          return lireInstantane(data.instantane);
        },
        // Le PDF enregistré — engendré maintenant s'il manque (appel émis hors de
        // l'écran), depuis l'instantané ; jamais reconstruit s'il existe.
        pdf: async (appelId) => {
          await engendrerDocumentAppel(supabase, appelId);
          return lireDocumentAppel(supabase, appelId);
        },
        tracer: async (trace) => {
          const { error } = await supabase.rpc("tracer_envoi_appel", {
            p_appel: trace.appelId,
            p_canal: "email",
            p_adresse: trace.adresse,
            p_adresse_prevue: trace.adressePrevue,
            p_reussi: trace.resultat.reussi,
            p_resultat: trace.resultat,
          });
          if (error) throw new Error(`Trace de l'envoi impossible : ${error.message}`);
        },
      },
    );
    revalidatePath(`/immeubles/${immeubleId}/appels`);
    return { etat: "termine", bilan, demonstration };
  } catch (erreur) {
    if (erreur instanceof EnvoiInterdit) return { etat: "refuse", motif: "garde_fou", detail: erreur.message };
    throw erreur;
  }
}
