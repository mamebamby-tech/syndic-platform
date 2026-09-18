import "server-only";
import { creerClientServeur } from "@/lib/supabase/server";
import type { StatutAppel, StatutPaiement, TypePersonne } from "@/lib/types/database";

export interface MembreGroupe {
  id: string;
  nom: string;
}

export interface LotReleve {
  numero: number;
  designation: string;
  tantiemes: number;
  quotePart: number;
}

export interface MouvementReleve {
  date: string;
  libelle: string;
  montant: number;
  sens: "du" | "paye";
  statut: string;
}

export interface ReleveProprietaire {
  proprietaireId: string;
  immeubleId: string;
  nom: string;
  type: TypePersonne;
  email: string | null;
  telephone: string | null;
  estGroupe: boolean;
  membresGroupe: MembreGroupe[];
  lots: LotReleve[];
  totalTantiemesImmeuble: number;
  totalAppele: number;
  totalPaye: number;
  solde: number;
  mouvements: MouvementReleve[];
}

export type ResultatReleve =
  | { type: "redirection"; versProprietaireId: string }
  | { type: "releve"; releve: ReleveProprietaire };

const LIBELLES_STATUT_APPEL: Record<StatutAppel, string> = {
  brouillon: "Brouillon",
  emis: "Émis",
  partiel: "Partiellement payé",
  solde: "Soldé",
  annule: "Annulé",
};

const LIBELLES_STATUT_PAIEMENT: Record<StatutPaiement, string> = {
  en_attente: "En attente",
  confirme: "Confirmé",
  echoue: "Échoué",
  rembourse: "Remboursé",
};

export async function chargerReleve(proprietaireId: string): Promise<ResultatReleve | null> {
  const supabase = await creerClientServeur();

  const { data: proprietaire, error: erreurProprietaire } = await supabase
    .from("proprietaires")
    .select("id, immeuble_id, nom, type, email, telephone, groupe_id, est_groupe")
    .eq("id", proprietaireId)
    .maybeSingle();

  if (erreurProprietaire) {
    throw new Error(`Lecture du propriétaire impossible : ${erreurProprietaire.message}`);
  }
  if (!proprietaire) {
    return null;
  }

  // Une entité groupée n'est jamais destinataire d'appel : le relevé vit
  // sur le groupe. On y redirige plutôt que de montrer une fiche vide.
  if (proprietaire.groupe_id) {
    return { type: "redirection", versProprietaireId: proprietaire.groupe_id };
  }

  const idsFacturation = [proprietaire.id];
  let membresGroupe: MembreGroupe[] = [];

  if (proprietaire.est_groupe) {
    const { data: membres, error: erreurMembres } = await supabase
      .from("proprietaires")
      .select("id, nom")
      .eq("groupe_id", proprietaire.id);

    if (erreurMembres) {
      throw new Error(`Lecture du groupe impossible : ${erreurMembres.message}`);
    }

    membresGroupe = membres ?? [];
    idsFacturation.push(...membresGroupe.map((membre) => membre.id));
  }

  const [
    { data: rattachements, error: erreurRattachements },
    { data: totalImmeuble, error: erreurTotalImmeuble },
    { data: appels, error: erreurAppels },
    { data: paiements, error: erreurPaiements },
  ] = await Promise.all([
    supabase
      .from("lot_proprietaires")
      .select("lot_id, quote_part")
      .in("proprietaire_id", idsFacturation)
      .is("date_fin", null),
    supabase.from("lots").select("id, numero, designation, tantiemes").eq(
      "immeuble_id",
      proprietaire.immeuble_id,
    ),
    supabase
      .from("appels")
      .select("id, reference, montant_total, statut, date_echeance, periode_id")
      .in("proprietaire_id", idsFacturation)
      .order("date_echeance", { ascending: false }),
    supabase
      .from("paiements")
      .select("id, montant, statut, date_paiement, moyen")
      .in("proprietaire_id", idsFacturation)
      .order("date_paiement", { ascending: false }),
  ]);

  if (erreurRattachements) {
    throw new Error(`Lecture des lots impossible : ${erreurRattachements.message}`);
  }
  if (erreurTotalImmeuble) {
    throw new Error(`Lecture des tantièmes de l'immeuble impossible : ${erreurTotalImmeuble.message}`);
  }
  if (erreurAppels) {
    throw new Error(`Lecture des appels impossible : ${erreurAppels.message}`);
  }
  if (erreurPaiements) {
    throw new Error(`Lecture des paiements impossible : ${erreurPaiements.message}`);
  }

  const totalTantiemesImmeuble = (totalImmeuble ?? []).reduce(
    (total, lot) => total + lot.tantiemes,
    0,
  );
  const lotParId = new Map((totalImmeuble ?? []).map((lot) => [lot.id, lot]));

  const lots: LotReleve[] = (rattachements ?? [])
    .map((rattachement) => {
      const lot = lotParId.get(rattachement.lot_id);
      if (!lot) return null;
      return {
        numero: lot.numero,
        designation: lot.designation,
        tantiemes: lot.tantiemes,
        quotePart: totalTantiemesImmeuble > 0 ? lot.tantiemes / totalTantiemesImmeuble : 0,
      };
    })
    .filter((lot): lot is LotReleve => lot !== null)
    .sort((a, b) => a.numero - b.numero);

  const periodeIds = Array.from(new Set((appels ?? []).map((appel) => appel.periode_id)));
  const { data: periodes, error: erreurPeriodes } = periodeIds.length
    ? await supabase.from("periodes").select("id, libelle").in("id", periodeIds)
    : { data: [], error: null };
  if (erreurPeriodes) {
    throw new Error(`Lecture des périodes impossible : ${erreurPeriodes.message}`);
  }
  const libellePeriodeParId = new Map((periodes ?? []).map((periode) => [periode.id, periode.libelle]));

  const totalAppele = (appels ?? []).reduce((total, appel) => total + appel.montant_total, 0);
  const totalPaye = (paiements ?? [])
    .filter((paiement) => paiement.statut === "confirme")
    .reduce((total, paiement) => total + paiement.montant, 0);

  const mouvements: MouvementReleve[] = [
    ...(appels ?? []).map((appel) => {
      const libellePeriode = libellePeriodeParId.get(appel.periode_id);
      return {
        date: appel.date_echeance,
        libelle: `Appel ${appel.reference}${libellePeriode ? ` — ${libellePeriode}` : ""}`,
        montant: appel.montant_total,
        sens: "du" as const,
        statut: LIBELLES_STATUT_APPEL[appel.statut],
      };
    }),
    ...(paiements ?? []).map((paiement) => ({
      date: paiement.date_paiement,
      libelle: `Paiement ${paiement.moyen}`,
      montant: paiement.montant,
      sens: "paye" as const,
      statut: LIBELLES_STATUT_PAIEMENT[paiement.statut],
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    type: "releve",
    releve: {
      proprietaireId: proprietaire.id,
      immeubleId: proprietaire.immeuble_id,
      nom: proprietaire.nom,
      type: proprietaire.type,
      email: proprietaire.email,
      telephone: proprietaire.telephone,
      estGroupe: proprietaire.est_groupe,
      membresGroupe,
      lots,
      totalTantiemesImmeuble,
      totalAppele,
      totalPaye,
      solde: totalAppele - totalPaye,
      mouvements,
    },
  };
}
