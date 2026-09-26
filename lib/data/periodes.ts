import "server-only";
import { creerClientServeur } from "@/lib/supabase/server";
import type { StatutPeriode } from "@/lib/types/database";

export interface Periode {
  id: string;
  libelle: string;
  dateDebut: string;
  dateFin: string;
  dateEcheance: string;
  statut: StatutPeriode;
  exerciceLibelle: string;
}

// La PÉRIODE DE TRAVAIL (décision 67) : la plus récente, émise ou non. Elle
// sert à préparer — écrans Budget et Appels de fonds. Ne pas la confondre avec
// la PÉRIODE EN COURS, qui sert à consulter et à piloter (tableau de bord,
// comptes) : voir choisirPeriodeEnCours dans lib/recouvrement/calcul.ts.
export async function trouverPeriodeDeTravail(
  immeubleId: string,
): Promise<Periode | null> {
  const supabase = await creerClientServeur();

  const { data: exercices, error: erreurExercices } = await supabase
    .from("exercices")
    .select("id, libelle")
    .eq("immeuble_id", immeubleId);

  if (erreurExercices) {
    throw new Error(`Lecture des exercices impossible : ${erreurExercices.message}`);
  }

  const exerciceParId = new Map((exercices ?? []).map((exercice) => [exercice.id, exercice]));
  const exerciceIds = (exercices ?? []).map((exercice) => exercice.id);

  if (exerciceIds.length === 0) {
    return null;
  }

  const { data: periodes, error: erreurPeriodes } = await supabase
    .from("periodes")
    .select("id, libelle, date_debut, date_fin, date_echeance, statut, exercice_id")
    .in("exercice_id", exerciceIds)
    .order("date_debut", { ascending: false })
    .limit(1);

  if (erreurPeriodes) {
    throw new Error(`Lecture des périodes impossible : ${erreurPeriodes.message}`);
  }

  const periode = periodes?.[0];
  if (!periode) {
    return null;
  }

  return {
    id: periode.id,
    libelle: periode.libelle,
    dateDebut: periode.date_debut,
    dateFin: periode.date_fin,
    dateEcheance: periode.date_echeance,
    statut: periode.statut,
    exerciceLibelle: exerciceParId.get(periode.exercice_id)?.libelle ?? "",
  };
}
