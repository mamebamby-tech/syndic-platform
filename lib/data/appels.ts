import "server-only";
import { creerClientServeur } from "@/lib/supabase/server";
import {
  anomaliesContact,
  etatEnvoi,
  type AnomalieContact,
  type EtatEnvoi,
} from "@/lib/data/anomalie-contact";
import type { MoyenPaiement, StatutAppel } from "@/lib/types/database";
import { appelDepuisInstantane, lireInstantane } from "@/lib/appels/instantane";

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
  // Anomalies de contact (détail) et état d'envoi qui en découle, par canal.
  anomalies: AnomalieContact[];
  envoi: EtatEnvoi;
  // Brouillon dont le budget a changé depuis la génération : à régénérer, et
  // refusé à l'émission par la base.
  obsolete: boolean;
  // Non nul pour un appel ÉMIS : le document se rend depuis cet instantané, pas
  // depuis le contexte courant de la période (voir lib/appels/instantane.ts).
  contexteEmis: ContexteDocument | null;
  lignes: LigneAppelDetail[];
}

// Coordonnées bancaires du syndicat. `null` tant qu'elles ne sont pas
// renseignées : l'émission des appels est alors bloquée (base de données).
export interface CompteSyndicat {
  titulaire: string;
  banque: string;
  numero: string;
  bic: string | null;
}

export interface ContexteDocument {
  organisationNom: string;
  organisationAdresse: string | null;
  organisationEmail: string | null;
  organisationNinea: string | null;
  organisationRccm: string | null;
  immeubleNom: string;
  periodeLibelle: string;
  compteSyndicat: CompteSyndicat | null;
  moyensPaiementAcceptes: MoyenPaiement[];
  // Numéro marchand par moyen mobile (wave, orange_money), pour les moyens acceptés.
  numerosMarchands: Record<string, string>;
  // Dernière modification des coordonnées de paiement : les copropriétaires la
  // voient sur l'appel, pour repérer un changement de compte.
  compteModifieLe: string | null;
}

export interface AppelsPeriode {
  appels: AppelDetail[];
  contexte: ContexteDocument;
}

// « Renseigné » = titulaire, banque et numéro non vides — la même définition
// que app.coordonnees_bancaires_completes, qui bloque l'émission en base.
function compteRenseigne(immeuble: {
  compte_titulaire: string | null;
  compte_banque: string | null;
  compte_numero: string | null;
  compte_bic: string | null;
}): CompteSyndicat | null {
  const titulaire = immeuble.compte_titulaire?.trim();
  const banque = immeuble.compte_banque?.trim();
  const numero = immeuble.compte_numero?.trim();
  if (!titulaire || !banque || !numero) return null;
  return { titulaire, banque, numero, bic: immeuble.compte_bic?.trim() || null };
}

export async function listerAppelsDeLaPeriode(
  immeubleId: string,
  periodeId: string,
  periodeLibelle: string,
): Promise<AppelsPeriode> {
  const supabase = await creerClientServeur();

  const [{ data: immeuble, error: erreurImmeuble }, { data: appels, error: erreurAppels }] =
    await Promise.all([
      supabase
        .from("immeubles")
        .select(
          "id, nom, organisation_id, compte_titulaire, compte_banque, compte_numero, compte_bic, moyens_paiement_acceptes, numeros_marchands, compte_modifie_le",
        )
        .eq("id", immeubleId)
        .single(),
      supabase
        .from("appels")
        .select(
          "id, reference, statut, montant_total, report_anterieur, date_echeance, date_emission, proprietaire_id, instantane, obsolete",
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
    compteSyndicat: compteRenseigne(immeuble),
    moyensPaiementAcceptes: immeuble.moyens_paiement_acceptes,
    numerosMarchands: immeuble.numeros_marchands,
    compteModifieLe: immeuble.compte_modifie_le,
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
    const vivant: AppelDetail = {
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
      envoi: proprietaire ? etatEnvoi(proprietaire) : "injoignable",
      lignes: (lignesParAppel.get(appel.id) ?? []).sort((a, b) => a.lotNumero - b.lotNumero),
      obsolete: appel.obsolete,
      contexteEmis: null,
    };

    // Appel émis : le document ne se rend QUE depuis son instantané. Un
    // instantané illisible fait échouer le chargement — jamais de repli sur
    // les données courantes.
    return appel.instantane === null
      ? vivant
      : appelDepuisInstantane(lireInstantane(appel.instantane), vivant);
  });

  return { appels: appelsDetail, contexte };
}
