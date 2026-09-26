import "server-only";
import { creerClientServeur } from "@/lib/supabase/server";
import type { PeriodeCourante } from "@/lib/data/periodes";
import { choisirPeriodeEnCours, situationDesAppels, type SituationAppel } from "@/lib/recouvrement/calcul";
import { etatEnvoi } from "@/lib/data/anomalie-contact";

export interface Destinataire {
  id: string;
  nom: string;
  estGroupe: boolean;
  injoignable: boolean;
}

export interface DonneesRecouvrement {
  // Date du jour (AAAA-MM-JJ, UTC comme toutes les dates du schéma).
  aujourdhui: string;
  // La période en cours au sens de la décision 67 : la plus récente émise, sinon
  // la prochaine à venir. Pas celle de trouverPeriodeCourante (Budget, Appels),
  // qui est la plus récente tout court : la période qu'on prépare.
  periode: PeriodeCourante | null;
  bornes: number[];
  situations: SituationAppel[];
  // Ceux à qui un appel est adressé : les entités non groupées et les groupes.
  destinataires: Destinataire[];
}

// PostgREST plafonne le nombre de lignes par réponse. Une somme d'argent calculée
// sur une réponse tronquée serait fausse sans le dire : on lit toutes les pages.
const TAILLE_PAGE = 1000;
async function toutesLesPages<T>(
  lire: (de: number, a: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  quoi: string,
): Promise<T[]> {
  const lignes: T[] = [];
  for (let de = 0; ; de += TAILLE_PAGE) {
    const { data, error } = await lire(de, de + TAILLE_PAGE - 1);
    if (error) throw new Error(`Lecture ${quoi} impossible : ${error.message}`);
    lignes.push(...(data ?? []));
    if ((data ?? []).length < TAILLE_PAGE) return lignes;
  }
}

export async function chargerRecouvrement(immeubleId: string): Promise<DonneesRecouvrement> {
  const supabase = await creerClientServeur();
  const aujourdhui = new Date().toISOString().slice(0, 10);

  const [{ data: immeuble, error: erreurImmeuble }, { data: exercices, error: erreurExercices }, proprietaires] =
    await Promise.all([
      supabase.from("immeubles").select("bornes_anciennete_jours").eq("id", immeubleId).maybeSingle(),
      supabase.from("exercices").select("id, libelle").eq("immeuble_id", immeubleId),
      toutesLesPages(
        (de, a) =>
          supabase
            .from("proprietaires")
            .select("id, nom, email, telephone, est_groupe")
            .eq("immeuble_id", immeubleId)
            .is("groupe_id", null)
            .order("nom")
            .range(de, a),
        "des propriétaires",
      ),
    ]);
  if (erreurImmeuble || !immeuble) {
    throw new Error(`Lecture de l'immeuble impossible : ${erreurImmeuble?.message ?? "introuvable"}`);
  }
  if (erreurExercices) throw new Error(`Lecture des exercices impossible : ${erreurExercices.message}`);

  const destinataires: Destinataire[] = proprietaires.map((p) => ({
    id: p.id,
    nom: p.nom,
    estGroupe: p.est_groupe,
    injoignable: etatEnvoi({ email: p.email, telephone: p.telephone }) === "injoignable",
  }));

  const exerciceIds = (exercices ?? []).map((e) => e.id);
  const { data: periodes, error: erreurPeriodes } = exerciceIds.length
    ? await supabase
        .from("periodes")
        .select("id, libelle, date_debut, date_fin, date_echeance, statut, exercice_id")
        .in("exercice_id", exerciceIds)
    : { data: [], error: null };
  if (erreurPeriodes) throw new Error(`Lecture des périodes impossible : ${erreurPeriodes.message}`);
  const periodeIds = (periodes ?? []).map((p) => p.id);

  const destinataireIds = destinataires.map((d) => d.id);
  const [appels, paiements] =
    periodeIds.length === 0 || destinataireIds.length === 0
      ? [[], []]
      : await Promise.all([
          toutesLesPages(
            (de, a) =>
              supabase
                .from("appels")
                .select("id, proprietaire_id, periode_id, montant_total, date_echeance, statut")
                .in("periode_id", periodeIds)
                .order("id")
                .range(de, a),
            "des appels",
          ),
          toutesLesPages(
            (de, a) =>
              supabase
                .from("paiements")
                .select("appel_id, montant, statut")
                .in("proprietaire_id", destinataireIds)
                .order("id")
                .range(de, a),
            "des paiements",
          ),
        ]);

  const situations = situationDesAppels(
    appels.map((a) => ({
      id: a.id,
      proprietaireId: a.proprietaire_id,
      periodeId: a.periode_id,
      montantTotal: Number(a.montant_total),
      dateEcheance: a.date_echeance,
      statut: a.statut,
    })),
    paiements.map((p) => ({ appelId: p.appel_id, montant: Number(p.montant), statut: p.statut })),
    aujourdhui,
  );

  const emises = new Set(situations.map((s) => s.periodeId));
  const libelleExercice = new Map((exercices ?? []).map((e) => [e.id, e.libelle]));
  const choisie = choisirPeriodeEnCours(
    (periodes ?? []).map((p) => ({ ...p, dateDebut: p.date_debut, emise: emises.has(p.id) })),
    aujourdhui,
  );
  const periode: PeriodeCourante | null = choisie && {
    id: choisie.id,
    libelle: choisie.libelle,
    dateDebut: choisie.date_debut,
    dateFin: choisie.date_fin,
    dateEcheance: choisie.date_echeance,
    statut: choisie.statut,
    exerciceLibelle: libelleExercice.get(choisie.exercice_id) ?? "",
  };

  return { aujourdhui, periode, bornes: immeuble.bornes_anciennete_jours, situations, destinataires };
}
