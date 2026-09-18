import "server-only";
import { creerClientServeur } from "@/lib/supabase/server";
import type { NatureDetention } from "@/lib/types/database";

export interface DetenteurLot {
  proprietaireId: string;
  nom: string;
  nature: NatureDetention;
  quotePart: number;
  groupeNom: string | null;
}

export interface LigneRegistreLot {
  id: string;
  numero: number;
  designation: string;
  niveau: string | null;
  etage: number | null;
  superficieM2: number | null;
  tantiemes: number;
  detenteurs: DetenteurLot[];
}

export interface RegistreLots {
  lots: LigneRegistreLot[];
  totalTantiemes: number;
}

// Lecture seule : les lots d'un immeuble et leurs détenteurs actuels
// (date_fin is null). Un lot en indivision affiche plusieurs détenteurs.
export async function listerRegistreLots(immeubleId: string): Promise<RegistreLots> {
  const supabase = await creerClientServeur();

  const { data: lots, error: erreurLots } = await supabase
    .from("lots")
    .select("id, numero, designation, niveau, etage, superficie_m2, tantiemes")
    .eq("immeuble_id", immeubleId)
    .order("numero");

  if (erreurLots) {
    throw new Error(`Lecture des lots impossible : ${erreurLots.message}`);
  }

  const lotIds = (lots ?? []).map((lot) => lot.id);

  const { data: rattachements, error: erreurRattachements } = lotIds.length
    ? await supabase
        .from("lot_proprietaires")
        .select("lot_id, proprietaire_id, nature, quote_part")
        .in("lot_id", lotIds)
        .is("date_fin", null)
    : { data: [], error: null };

  if (erreurRattachements) {
    throw new Error(
      `Lecture des rattachements impossible : ${erreurRattachements.message}`,
    );
  }

  const proprietaireIds = Array.from(
    new Set((rattachements ?? []).map((rattachement) => rattachement.proprietaire_id)),
  );

  const { data: proprietaires, error: erreurProprietaires } = proprietaireIds.length
    ? await supabase
        .from("proprietaires")
        .select("id, nom, groupe_id")
        .in("id", proprietaireIds)
    : { data: [], error: null };

  if (erreurProprietaires) {
    throw new Error(
      `Lecture des propriétaires impossible : ${erreurProprietaires.message}`,
    );
  }

  const groupeIds = Array.from(
    new Set(
      (proprietaires ?? [])
        .map((proprietaire) => proprietaire.groupe_id)
        .filter((id): id is string => id !== null),
    ),
  );

  const { data: groupes, error: erreurGroupes } = groupeIds.length
    ? await supabase.from("proprietaires").select("id, nom").in("id", groupeIds)
    : { data: [], error: null };

  if (erreurGroupes) {
    throw new Error(`Lecture des groupes impossible : ${erreurGroupes.message}`);
  }

  const nomGroupeParId = new Map((groupes ?? []).map((groupe) => [groupe.id, groupe.nom]));
  const proprietaireParId = new Map(
    (proprietaires ?? []).map((proprietaire) => [proprietaire.id, proprietaire]),
  );

  const detenteursParLot = new Map<string, DetenteurLot[]>();
  for (const rattachement of rattachements ?? []) {
    const proprietaire = proprietaireParId.get(rattachement.proprietaire_id);
    if (!proprietaire) continue;

    const detenteur: DetenteurLot = {
      proprietaireId: proprietaire.id,
      nom: proprietaire.nom,
      nature: rattachement.nature,
      quotePart: rattachement.quote_part,
      groupeNom: proprietaire.groupe_id
        ? (nomGroupeParId.get(proprietaire.groupe_id) ?? null)
        : null,
    };

    const liste = detenteursParLot.get(rattachement.lot_id) ?? [];
    liste.push(detenteur);
    detenteursParLot.set(rattachement.lot_id, liste);
  }

  const lignes: LigneRegistreLot[] = (lots ?? []).map((lot) => ({
    id: lot.id,
    numero: lot.numero,
    designation: lot.designation,
    niveau: lot.niveau,
    etage: lot.etage,
    superficieM2: lot.superficie_m2,
    tantiemes: lot.tantiemes,
    detenteurs: detenteursParLot.get(lot.id) ?? [],
  }));

  return {
    lots: lignes,
    totalTantiemes: lignes.reduce((total, lot) => total + lot.tantiemes, 0),
  };
}
