import "server-only";
import { creerClientServeur } from "@/lib/supabase/server";

export interface CleRepartitionOption {
  id: string;
  code: string;
  libelle: string;
}

export interface LignePoste {
  posteId: string;
  libelle: string;
  categorie: string;
  ordre: number;
  cleRepartitionId: string;
  fournisseur: string;
  montant: number;
  note: string;
  aZero: boolean;
}

export interface BudgetPeriode {
  lignes: LignePoste[];
  cles: CleRepartitionOption[];
  // Somme de tous les postes : les charges communes. Les totaux par
  // catégorie de suivi (`general`, `ascenseur`) les décomposent.
  totalChargesCommunes: number;
  totauxParCategorie: { categorie: string; total: number }[];
  nombrePostesAZero: number;
  // Des appels de la période sont émis (et non annulés) : le budget est verrouillé
  // en base. Toute correction passera par un appel complémentaire ou un avoir.
  verrouille: boolean;
  // Brouillons dont le budget a changé depuis la génération : à régénérer.
  nombreBrouillonsObsoletes: number;
}

export async function chargerBudget(
  immeubleId: string,
  periodeId: string,
): Promise<BudgetPeriode> {
  const supabase = await creerClientServeur();

  const [{ data: postes, error: erreurPostes }, { data: cles, error: erreurCles }, { data: budgetLignes, error: erreurBudget }] =
    await Promise.all([
      supabase
        .from("postes_charges")
        .select("id, libelle, categorie, ordre, cle_repartition_id")
        .eq("immeuble_id", immeubleId)
        .order("ordre"),
      supabase
        .from("cles_repartition")
        .select("id, code, libelle")
        .eq("immeuble_id", immeubleId)
        .order("libelle"),
      supabase
        .from("budget_lignes")
        .select("poste_charge_id, montant, fournisseur, note")
        .eq("periode_id", periodeId),
    ]);

  if (erreurPostes) {
    throw new Error(`Lecture des postes de charges impossible : ${erreurPostes.message}`);
  }
  if (erreurCles) {
    throw new Error(`Lecture des clés de répartition impossible : ${erreurCles.message}`);
  }
  if (erreurBudget) {
    throw new Error(`Lecture du budget impossible : ${erreurBudget.message}`);
  }

  const [{ count: emis, error: erreurEmis }, { count: obsoletes, error: erreurObsoletes }] =
    await Promise.all([
      supabase
        .from("appels")
        .select("id", { count: "exact", head: true })
        .eq("periode_id", periodeId)
        .neq("statut", "annule")
        .not("instantane", "is", null),
      supabase
        .from("appels")
        .select("id", { count: "exact", head: true })
        .eq("periode_id", periodeId)
        .eq("statut", "brouillon")
        .eq("obsolete", true),
    ]);
  if (erreurEmis) throw new Error(`Lecture des appels émis impossible : ${erreurEmis.message}`);
  if (erreurObsoletes) throw new Error(`Lecture des appels obsolètes impossible : ${erreurObsoletes.message}`);

  const budgetParPoste = new Map(
    (budgetLignes ?? []).map((ligne) => [ligne.poste_charge_id, ligne]),
  );

  const lignes: LignePoste[] = (postes ?? []).map((poste) => {
    const ligneBudget = budgetParPoste.get(poste.id);
    const montant = ligneBudget?.montant ?? 0;
    return {
      posteId: poste.id,
      libelle: poste.libelle,
      categorie: poste.categorie,
      ordre: poste.ordre,
      cleRepartitionId: poste.cle_repartition_id,
      fournisseur: ligneBudget?.fournisseur ?? "",
      montant,
      note: ligneBudget?.note ?? "",
      aZero: montant === 0,
    };
  });

  const totauxParCategorieMap = new Map<string, number>();
  for (const ligne of lignes) {
    totauxParCategorieMap.set(
      ligne.categorie,
      (totauxParCategorieMap.get(ligne.categorie) ?? 0) + ligne.montant,
    );
  }

  return {
    lignes,
    cles: cles ?? [],
    totalChargesCommunes: lignes.reduce((total, ligne) => total + ligne.montant, 0),
    totauxParCategorie: Array.from(totauxParCategorieMap.entries()).map(
      ([categorie, total]) => ({ categorie, total }),
    ),
    nombrePostesAZero: lignes.filter((ligne) => ligne.aZero).length,
    verrouille: (emis ?? 0) > 0,
    nombreBrouillonsObsoletes: obsoletes ?? 0,
  };
}
