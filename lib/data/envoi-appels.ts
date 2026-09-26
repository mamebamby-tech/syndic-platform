import "server-only";
import { creerClientServeur } from "@/lib/supabase/server";
import { trouverPeriodeDeTravail, type Periode } from "@/lib/data/periodes";
import type { AppelAEnvoyer } from "@/lib/appels/envoi";

// Ce que l'écran d'envoi lit : les appels ÉMIS de la période de travail (décision
// 67), le contact ACTUEL de chaque destinataire (c'est là que le message part),
// la date du dernier envoi réussi (journal) et la présence du PDF.

export interface DonneesEnvoi {
  periode: Periode | null;
  appels: AppelAEnvoyer[];
  // Appels émis dont le PDF n'est pas encore engendré (émis hors de l'écran).
  sansPdf: string[];
  adresseCabinet: string | null;
  // Nom affiché de l'expéditeur (décision 68), lu au moment de l'envoi.
  nomCabinet: string | null;
}

export async function chargerAppelsAEnvoyer(immeubleId: string): Promise<DonneesEnvoi> {
  const supabase = await creerClientServeur();
  const periode = await trouverPeriodeDeTravail(immeubleId);
  const { data: immeuble, error: erreurImmeuble } = await supabase
    .from("immeubles")
    .select("organisation_id")
    .eq("id", immeubleId)
    .maybeSingle();
  if (erreurImmeuble || !immeuble) throw new Error("Lecture de l'immeuble impossible");
  const { data: organisation } = await supabase
    .from("organisations")
    .select("nom, email")
    .eq("id", immeuble.organisation_id)
    .maybeSingle();
  const adresseCabinet = organisation?.email ?? null;
  const nomCabinet = organisation?.nom ?? null;
  if (!periode) return { periode, appels: [], sansPdf: [], adresseCabinet, nomCabinet };

  const { data: appels, error } = await supabase
    .from("appels")
    .select("id, reference, proprietaire_id, statut")
    .eq("periode_id", periode.id)
    .in("statut", ["emis", "partiel", "solde"]);
  if (error) throw new Error(`Lecture des appels impossible : ${error.message}`);
  const ids = (appels ?? []).map((a) => a.id);
  if (ids.length === 0) return { periode, appels: [], sansPdf: [], adresseCabinet, nomCabinet };

  const [{ data: proprietaires, error: e1 }, { data: envois, error: e2 }, { data: documents, error: e3 }] =
    await Promise.all([
      supabase
        .from("proprietaires")
        .select("id, nom, email, telephone, langue")
        .in("id", (appels ?? []).map((a) => a.proprietaire_id)),
      supabase
        .from("journal")
        .select("entite_id, cree_le")
        .eq("entite", "appels")
        .eq("action", "appel_envoye")
        .in("entite_id", ids),
      supabase.from("documents_appels").select("appel_id").in("appel_id", ids),
    ]);
  if (e1 || e2 || e3) throw new Error(`Lecture des données d'envoi impossible : ${(e1 ?? e2 ?? e3)!.message}`);

  const parId = new Map((proprietaires ?? []).map((p) => [p.id, p]));
  const dernierEnvoi = new Map<string, string>();
  for (const e of envois ?? []) {
    if (!e.entite_id) continue;
    const avant = dernierEnvoi.get(e.entite_id);
    if (!avant || avant < e.cree_le) dernierEnvoi.set(e.entite_id, e.cree_le);
  }
  const avecPdf = new Set((documents ?? []).map((d) => d.appel_id));

  return {
    periode,
    adresseCabinet,
    nomCabinet,
    sansPdf: ids.filter((id) => !avecPdf.has(id)),
    appels: (appels ?? []).map((a) => {
      const p = parId.get(a.proprietaire_id);
      return {
        appelId: a.id,
        reference: a.reference,
        destinataireId: a.proprietaire_id,
        destinataireNom: p?.nom ?? "",
        email: p?.email ?? null,
        telephone: p?.telephone ?? null,
        langue: p?.langue ?? null,
        dernierEnvoiLe: dernierEnvoi.get(a.id) ?? null,
      };
    }),
  };
}
