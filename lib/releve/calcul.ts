import type { MoyenPaiement, StatutAppel, StatutPaiement } from "@/lib/types/database";

// Le calcul du relevé d'un propriétaire, séparé de la lecture en base pour être testé
// sans connexion. Aucune règle juridique ici : seulement ce que dit le vocabulaire
// des statuts d'un appel.

// Seuls ces appels ont été ENVOYÉS et sont dus : c'est ce qui compte dans le total
// appelé. Un brouillon n'a pas été émis ; un appel annulé est retiré (on l'annule
// pour en émettre un autre : le compter doublerait la somme).
export const STATUTS_APPEL_COMPTES: readonly StatutAppel[] = ["emis", "partiel", "solde"];
export const appelCompte = (statut: StatutAppel) => STATUTS_APPEL_COMPTES.includes(statut);

// Les montants sont numeric(14,2) : additionnés en centimes entiers, jamais en flottants.
const enCentimes = (montant: number) => Math.round(montant * 100);
export function somme(montants: number[]): number {
  return montants.reduce((total, m) => total + enCentimes(m), 0) / 100;
}

export interface AppelBrut {
  id: string;
  reference: string;
  montant_total: number;
  statut: StatutAppel;
  date_echeance: string;
  periode_id: string;
}

export interface PaiementBrut {
  id: string;
  appel_id: string | null;
  montant: number;
  moyen: MoyenPaiement;
  statut: StatutPaiement;
  date_paiement: string;
  reference_externe: string | null;
  annule_paiement_id: string | null;
  motif: string | null;
}

// Un mouvement porte des codes et des données, jamais un libellé rédigé :
// c'est l'écran qui le met en mots, dans la langue de la personne
// (messages/*.json, `Releve.mouvement*`, `StatutAppelReleve.*`, etc.).
export type MouvementReleve =
  | {
      type: "appel";
      date: string;
      reference: string;
      periodeLibelle: string | null;
      montant: number;
      sens: "du";
      statut: StatutAppel;
      // Faux pour un appel annulé : il figure au relevé mais n'entre pas dans le total.
      compte: boolean;
    }
  | {
      type: "paiement";
      id: string;
      date: string;
      moyen: MoyenPaiement;
      // Négatif pour une annulation (écriture inverse).
      montant: number;
      sens: "paye";
      statut: StatutPaiement;
      appelReference: string | null;
      referenceExterne: string | null;
      annulation: boolean;
      motif: string | null;
      // Un paiement d'origine, pas encore annulé : le seul qu'on puisse annuler.
      annulable: boolean;
      dejaAnnule: boolean;
    };

export interface TotauxReleve {
  totalAppele: number;
  totalPaye: number;
  solde: number;
}

export function calculerTotaux(appels: AppelBrut[], paiements: PaiementBrut[]): TotauxReleve {
  const totalAppele = somme(appels.filter((a) => appelCompte(a.statut)).map((a) => a.montant_total));
  // Une annulation est un paiement de montant négatif : la somme les compense.
  const totalPaye = somme(paiements.filter((p) => p.statut === "confirme").map((p) => p.montant));
  return { totalAppele, totalPaye, solde: somme([totalAppele, -totalPaye]) };
}

export function composerMouvements(
  appels: AppelBrut[],
  paiements: PaiementBrut[],
  libellePeriodeParId: Map<string, string>,
): MouvementReleve[] {
  const referenceParAppel = new Map(appels.map((a) => [a.id, a.reference]));
  const annules = new Set(paiements.map((p) => p.annule_paiement_id).filter((id): id is string => id !== null));

  return [
    // Un brouillon n'a pas été émis : il n'est pas au relevé.
    ...appels
      .filter((a) => a.statut !== "brouillon")
      .map(
        (a): MouvementReleve => ({
          type: "appel",
          date: a.date_echeance,
          reference: a.reference,
          periodeLibelle: libellePeriodeParId.get(a.periode_id) ?? null,
          montant: a.montant_total,
          sens: "du",
          statut: a.statut,
          compte: appelCompte(a.statut),
        }),
      ),
    ...paiements.map((p): MouvementReleve => {
      const annulation = p.annule_paiement_id !== null;
      return {
        type: "paiement",
        id: p.id,
        date: p.date_paiement,
        moyen: p.moyen,
        montant: p.montant,
        sens: "paye",
        statut: p.statut,
        appelReference: p.appel_id ? (referenceParAppel.get(p.appel_id) ?? null) : null,
        referenceExterne: p.reference_externe,
        annulation,
        motif: p.motif,
        annulable: !annulation && !annules.has(p.id),
        dejaAnnule: !annulation && annules.has(p.id),
      };
    }),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export interface AppelPayable {
  id: string;
  reference: string;
  montantTotal: number;
  resteDu: number;
}

// Les appels sur lesquels on peut encore enregistrer un paiement : émis ou
// partiellement payés, avec un reste dû.
export function appelsPayables(appels: AppelBrut[], paiements: PaiementBrut[]): AppelPayable[] {
  return appels
    .filter((a) => a.statut === "emis" || a.statut === "partiel")
    .map((a) => {
      const paye = somme(paiements.filter((p) => p.appel_id === a.id && p.statut === "confirme").map((p) => p.montant));
      return { id: a.id, reference: a.reference, montantTotal: a.montant_total, resteDu: somme([a.montant_total, -paye]) };
    })
    .filter((a) => a.resteDu > 0)
    .sort((a, b) => (a.reference < b.reference ? -1 : 1));
}
