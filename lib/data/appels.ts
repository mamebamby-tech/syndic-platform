import "server-only";
import { creerClientServeur } from "@/lib/supabase/server";
import { anomaliesContact, type AnomalieContact } from "@/lib/data/anomalie-contact";
import type { StatutAppel } from "@/lib/types/database";

export interface LigneAppelDetail {
  lotNumero: number;
  posteLibelle: string;
  baseCalcul: number;
  montant: number;
}

export interface AppelDetail {
  id: string;
  reference: string;
  statut: StatutAppel;
  montantTotal: number;
  reportAnterieur: number;
  dateEcheance: string;
  dateEmission: string | null;
  proprietaireId: string;
  proprietaireNom: string;
  anomalies: AnomalieContact[];
  lignes: LigneAppelDetail[];
}

export interface ContexteDocument {
  organisationNom: string;
  organisationAdresse: string | null;
  organisationEmail: string | null;
  organisationNinea: string | null;
  organisationRccm: string | null;
  immeubleNom: string;
  periodeLibelle: string;
}

export interface AppelsPeriode {
  appels: AppelDetail[];
  contexte: ContexteDocument;
}

export async function listerAppelsDeLaPeriode(
  immeubleId: string,
  periodeId: string,
  periodeLibelle: string,
): Promise<AppelsPeriode> {
  const supabase = await creerClientServeur();

  const [{ data: immeuble, error: erreurImmeuble }, { data: appels, error: erreurAppels }] =
    await Promise.all([
      supabase.from("immeubles").select("id, nom, organisation_id").eq("id", immeubleId).single(),
      supabase
        .from("appels")
        .select(
          "id, reference, statut, montant_total, report_anterieur, date_echeance, date_emission, proprietaire_id",
        )
        .eq("periode_id", periodeId)
        .order("reference"),
    ]);

  if (erreurImmeuble) {
    throw new Error(`Lecture de l'immeuble impossible : ${erreurImmeuble.message}`);
  }
  if (erreurAppels) {
    throw new Error(`Lecture des appels impossible : ${erreurAppels.message}`);
  }

  const { data: organisation, error: erreurOrganisation } = await supabase
    .from("organisations")
    .select("nom, adresse, email, ninea, rccm")
    .eq("id", immeuble.organisation_id)
    .single();

  if (erreurOrganisation) {
    throw new Error(`Lecture du cabinet impossible : ${erreurOrganisation.message}`);
  }

  const contexte: ContexteDocument = {
    organisationNom: organisation.nom,
    organisationAdresse: organisation.adresse,
    organisationEmail: organisation.email,
    organisationNinea: organisation.ninea,
    organisationRccm: organisation.rccm,
    immeubleNom: immeuble.nom,
    periodeLibelle,
  };

  const appelIds = (appels ?? []).map((appel) => appel.id);
  const proprietaireIds = Array.from(
    new Set((appels ?? []).map((appel) => appel.proprietaire_id)),
  );

  const [{ data: proprietaires, error: erreurProprietaires }, { data: lignes, error: erreurLignes }] =
    await Promise.all([
      proprietaireIds.length
        ? supabase
            .from("proprietaires")
            .select("id, nom, email, telephone")
            .in("id", proprietaireIds)
        : Promise.resolve({ data: [], error: null }),
      appelIds.length
        ? supabase
            .from("appel_lignes")
            .select("appel_id, lot_id, poste_charge_id, base_calcul, montant")
            .in("appel_id", appelIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (erreurProprietaires) {
    throw new Error(`Lecture des propriétaires impossible : ${erreurProprietaires.message}`);
  }
  if (erreurLignes) {
    throw new Error(`Lecture du détail des appels impossible : ${erreurLignes.message}`);
  }

  const lotIds = Array.from(new Set((lignes ?? []).map((ligne) => ligne.lot_id)));
  const posteIds = Array.from(new Set((lignes ?? []).map((ligne) => ligne.poste_charge_id)));

  const [{ data: lots, error: erreurLots }, { data: postes, error: erreurPostes }] =
    await Promise.all([
      lotIds.length
        ? supabase.from("lots").select("id, numero").in("id", lotIds)
        : Promise.resolve({ data: [], error: null }),
      posteIds.length
        ? supabase.from("postes_charges").select("id, libelle").in("id", posteIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (erreurLots) {
    throw new Error(`Lecture des lots impossible : ${erreurLots.message}`);
  }
  if (erreurPostes) {
    throw new Error(`Lecture des postes de charges impossible : ${erreurPostes.message}`);
  }

  const proprietaireParId = new Map(
    (proprietaires ?? []).map((proprietaire) => [proprietaire.id, proprietaire]),
  );
  const numeroParLot = new Map((lots ?? []).map((lot) => [lot.id, lot.numero]));
  const libelleParPoste = new Map((postes ?? []).map((poste) => [poste.id, poste.libelle]));

  const lignesParAppel = new Map<string, LigneAppelDetail[]>();
  for (const ligne of lignes ?? []) {
    const liste = lignesParAppel.get(ligne.appel_id) ?? [];
    liste.push({
      lotNumero: numeroParLot.get(ligne.lot_id) ?? 0,
      posteLibelle: libelleParPoste.get(ligne.poste_charge_id) ?? "",
      baseCalcul: ligne.base_calcul,
      montant: ligne.montant,
    });
    lignesParAppel.set(ligne.appel_id, liste);
  }
  for (const liste of lignesParAppel.values()) {
    liste.sort((a, b) => a.lotNumero - b.lotNumero);
  }

  const appelsDetail: AppelDetail[] = (appels ?? []).map((appel) => {
    const proprietaire = proprietaireParId.get(appel.proprietaire_id);
    return {
      id: appel.id,
      reference: appel.reference,
      statut: appel.statut,
      montantTotal: appel.montant_total,
      reportAnterieur: appel.report_anterieur,
      dateEcheance: appel.date_echeance,
      dateEmission: appel.date_emission,
      proprietaireId: appel.proprietaire_id,
      proprietaireNom: proprietaire?.nom ?? "",
      anomalies: proprietaire ? anomaliesContact(proprietaire) : [],
      lignes: (lignesParAppel.get(appel.id) ?? []).sort((a, b) => a.lotNumero - b.lotNumero),
    };
  });

  return { appels: appelsDetail, contexte };
}
