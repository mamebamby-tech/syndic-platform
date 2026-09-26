import type { StatutAppel, StatutPaiement } from "@/lib/types/database";
import { appelCompte } from "@/lib/releve/calcul";

// Le recouvrement d'un immeuble, séparé de la lecture en base pour être testé
// sans connexion (tests/recouvrement-calcul.test.ts). Aucune règle juridique
// ici : les bornes des tranches d'ancienneté sont un paramètre d'immeuble
// (immeubles.bornes_anciennete_jours), passé en argument.
//
// Les montants sont numeric(14,2) : additionnés en centimes entiers, jamais en
// flottants, puis rendus en francs.

const enCentimes = (montant: number) => Math.round(montant * 100);
const enFrancs = (centimes: number) => centimes / 100;

export interface AppelRecouvrement {
  id: string;
  proprietaireId: string;
  periodeId: string;
  montantTotal: number;
  dateEcheance: string;
  statut: StatutAppel;
}

export interface PaiementRecouvrement {
  appelId: string | null;
  montant: number;
  statut: StatutPaiement;
}

// Un appel dû (émis, partiel ou soldé), ce qui en a été payé, ce qui en reste.
export interface SituationAppel {
  appelId: string;
  proprietaireId: string;
  periodeId: string;
  montantTotal: number;
  // Payé et imputé à cet appel : jamais plus que son montant.
  paye: number;
  resteDu: number;
  // Payé au-delà du montant de l'appel. La base le refuse (PA002) ; s'il
  // apparaissait, il ne réduit pas la dette d'un autre appel : l'imputer
  // ailleurs est une décision (avoir, remboursement), pas un calcul.
  tropPercu: number;
  dateEcheance: string;
  // Jours écoulés depuis l'échéance : 0 le jour même, négatif avant.
  joursDepuisEcheance: number;
}

// Nombre de jours entre deux dates de calendrier (AAAA-MM-JJ), en UTC comme
// toutes les dates du schéma (i18n/formats.ts, FUSEAU).
export function joursEntre(debut: string, fin: string): number {
  const jour = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86_400_000;
  return Math.round(jour(fin) - jour(debut));
}

export function situationDesAppels(
  appels: AppelRecouvrement[],
  paiements: PaiementRecouvrement[],
  aujourdhui: string,
): SituationAppel[] {
  const payeParAppel = new Map<string, number>();
  for (const p of paiements) {
    // Une annulation est un paiement confirmé de montant négatif : elle compense.
    if (p.statut !== "confirme" || p.appelId === null) continue;
    payeParAppel.set(p.appelId, (payeParAppel.get(p.appelId) ?? 0) + enCentimes(p.montant));
  }

  return appels
    .filter((a) => appelCompte(a.statut))
    .map((a) => {
      const du = enCentimes(a.montantTotal);
      const verse = Math.max(0, payeParAppel.get(a.id) ?? 0);
      const impute = Math.min(verse, du);
      return {
        appelId: a.id,
        proprietaireId: a.proprietaireId,
        periodeId: a.periodeId,
        montantTotal: enFrancs(du),
        paye: enFrancs(impute),
        resteDu: enFrancs(du - impute),
        tropPercu: enFrancs(verse - impute),
        dateEcheance: a.dateEcheance,
        joursDepuisEcheance: joursEntre(a.dateEcheance, aujourdhui),
      };
    });
}

export interface Recouvrement {
  nombreAppels: number;
  appele: number;
  encaisse: number;
  resteDu: number;
  tropPercu: number;
  // Part de l'appelé encaissée, entre 0 et 1 ; null s'il n'y a rien d'appelé
  // (aucun appel émis) : 0 % y serait faux, et 100 % aussi.
  taux: number | null;
}

// Appelé = encaissé + reste dû, toujours : le trop-perçu est à part.
export function calculerRecouvrement(situations: SituationAppel[]): Recouvrement {
  const total = (champ: (s: SituationAppel) => number) =>
    situations.reduce((somme, s) => somme + enCentimes(champ(s)), 0);
  const appele = total((s) => s.montantTotal);
  const encaisse = total((s) => s.paye);
  return {
    nombreAppels: situations.length,
    appele: enFrancs(appele),
    encaisse: enFrancs(encaisse),
    resteDu: enFrancs(appele - encaisse),
    tropPercu: enFrancs(total((s) => s.tropPercu)),
    taux: appele > 0 ? encaisse / appele : null,
  };
}

// --- Tranches d'ancienneté ---------------------------------------------------

export interface TrancheAnciennete {
  // Stable et lisible dans une adresse : « a-echoir », « 1-30 », « 91-plus ».
  cle: string;
  // Bornes en jours depuis l'échéance, incluses ; null = sans borne.
  // « À échoir » : échéance pas encore atteinte (jours ≤ 0).
  min: number | null;
  max: number | null;
}

export class BornesAncienneteInvalides extends Error {}

// Même règle que app.bornes_anciennete_valides : au moins une borne, entières,
// positives, strictement croissantes.
export function validerBornes(bornes: readonly number[]): void {
  const valides =
    bornes.length > 0 &&
    bornes.every((b, i) => Number.isInteger(b) && b >= 1 && (i === 0 || b > bornes[i - 1]!));
  if (!valides) {
    throw new BornesAncienneteInvalides(`Bornes d'ancienneté invalides : ${JSON.stringify(bornes)}`);
  }
}

export function tranchesAnciennete(bornes: readonly number[]): TrancheAnciennete[] {
  validerBornes(bornes);
  const tranches: TrancheAnciennete[] = [{ cle: "a-echoir", min: null, max: 0 }];
  let min = 1;
  for (const max of bornes) {
    tranches.push({ cle: `${min}-${max}`, min, max });
    min = max + 1;
  }
  tranches.push({ cle: `${min}-plus`, min, max: null });
  return tranches;
}

export function trancheDe(jours: number, tranches: TrancheAnciennete[]): TrancheAnciennete {
  const tranche = tranches.find(
    (t) => (t.min === null || jours >= t.min) && (t.max === null || jours <= t.max),
  );
  // Les tranches couvrent tout l'axe par construction.
  return tranche!;
}

export interface MontantParTranche {
  tranche: TrancheAnciennete;
  montant: number;
  // Compté par APPEL, pas par propriétaire : un propriétaire qui doit sur deux
  // appels d'âges différents figure dans deux tranches, et la somme des tranches
  // doit rester lisible (elle ne se compare pas au nombre de propriétaires).
  nombreAppels: number;
}

// Le reste dû de chaque appel, toutes périodes confondues, rangé selon les
// jours écoulés depuis son échéance.
export function repartirParTranche(
  situations: SituationAppel[],
  bornes: readonly number[],
): MontantParTranche[] {
  const tranches = tranchesAnciennete(bornes);
  const cumul = new Map(tranches.map((t) => [t.cle, { centimes: 0, appels: 0 }]));
  for (const s of situations) {
    if (s.resteDu <= 0) continue;
    const c = cumul.get(trancheDe(s.joursDepuisEcheance, tranches).cle)!;
    c.centimes += enCentimes(s.resteDu);
    c.appels += 1;
  }
  return tranches.map((tranche) => {
    const c = cumul.get(tranche.cle)!;
    return { tranche, montant: enFrancs(c.centimes), nombreAppels: c.appels };
  });
}

// En retard : un reste dû dont l'échéance est passée (au moins un jour).
export function estEnRetard(s: SituationAppel): boolean {
  return s.resteDu > 0 && s.joursDepuisEcheance >= 1;
}

export interface Retards {
  nombreProprietaires: number;
  montant: number;
}

// Les propriétaires en retard, un par ligne : ce qu'ils doivent d'échu et depuis
// combien de jours pour le plus ancien. Le plus ancien retard d'abord (c'est
// celui qu'on relance en premier), puis le plus gros montant.
export interface ProprietaireEnRetard {
  proprietaireId: string;
  montantEchu: number;
  joursRetardMax: number;
}

export function listerRetards(situations: SituationAppel[]): ProprietaireEnRetard[] {
  const parProprietaire = new Map<string, { centimes: number; jours: number }>();
  for (const s of situations.filter(estEnRetard)) {
    const p = parProprietaire.get(s.proprietaireId) ?? { centimes: 0, jours: 0 };
    p.centimes += enCentimes(s.resteDu);
    p.jours = Math.max(p.jours, s.joursDepuisEcheance);
    parProprietaire.set(s.proprietaireId, p);
  }
  return [...parProprietaire]
    .map(([proprietaireId, p]) => ({ proprietaireId, montantEchu: enFrancs(p.centimes), joursRetardMax: p.jours }))
    .sort(
      (a, b) =>
        b.joursRetardMax - a.joursRetardMax ||
        b.montantEchu - a.montantEchu ||
        a.proprietaireId.localeCompare(b.proprietaireId),
    );
}

export function calculerRetards(situations: SituationAppel[]): Retards {
  const enRetard = situations.filter(estEnRetard);
  return {
    nombreProprietaires: new Set(enRetard.map((s) => s.proprietaireId)).size,
    montant: enFrancs(enRetard.reduce((somme, s) => somme + enCentimes(s.resteDu), 0)),
  };
}

// --- Comptes par propriétaire (la liste vers laquelle mènent les cartes) -------

export type StatutCompte = "solde" | "partiel" | "impaye";

export interface CompteProprietaire {
  proprietaireId: string;
  // La période en cours ; null si le propriétaire n'y a pas d'appel dû.
  periode: { appele: number; paye: number; resteDu: number; statut: StatutCompte } | null;
  // Tout ce qui reste dû, toutes périodes confondues, et la part échue.
  resteDuTotal: number;
  resteDuEchu: number;
  // Tranches dans lesquelles tombe au moins un reste dû du propriétaire.
  clesTranches: string[];
  // Retard du plus ancien reste dû échu ; null s'il n'y en a pas.
  joursRetardMax: number | null;
}

export function statutCompte(appele: number, paye: number): StatutCompte {
  if (enCentimes(paye) >= enCentimes(appele)) return "solde";
  return paye > 0 ? "partiel" : "impaye";
}

export function comptesParProprietaire(
  situations: SituationAppel[],
  periodeCouranteId: string | null,
  bornes: readonly number[],
): Map<string, CompteProprietaire> {
  const tranches = tranchesAnciennete(bornes);
  const parProprietaire = new Map<string, SituationAppel[]>();
  for (const s of situations) {
    parProprietaire.set(s.proprietaireId, [...(parProprietaire.get(s.proprietaireId) ?? []), s]);
  }

  const comptes = new Map<string, CompteProprietaire>();
  for (const [proprietaireId, siennes] of parProprietaire) {
    const courantes = siennes.filter((s) => s.periodeId === periodeCouranteId);
    const periode = courantes.length === 0 ? null : calculerRecouvrement(courantes);
    const dues = siennes.filter((s) => s.resteDu > 0);
    const echues = dues.filter(estEnRetard);
    comptes.set(proprietaireId, {
      proprietaireId,
      periode: periode && {
        appele: periode.appele,
        paye: periode.encaisse,
        resteDu: periode.resteDu,
        statut: statutCompte(periode.appele, periode.encaisse),
      },
      resteDuTotal: calculerRecouvrement(dues).resteDu,
      resteDuEchu: calculerRecouvrement(echues).resteDu,
      clesTranches: [...new Set(dues.map((s) => trancheDe(s.joursDepuisEcheance, tranches).cle))],
      joursRetardMax: echues.length === 0 ? null : Math.max(...echues.map((s) => s.joursDepuisEcheance)),
    });
  }
  return comptes;
}

// --- La période en cours (décision 67) ------------------------------------------

export interface PeriodeCandidate {
  id: string;
  dateDebut: string;
  // Au moins un de ses appels a été émis (émis, partiel ou soldé).
  emise: boolean;
}

// La période la plus récente dont l'appel a été émis ; s'il n'en existe aucune,
// la prochaine période à venir (qui commence après aujourd'hui). Jamais « la
// période qui contient la date du jour » : un trimestre dont les appels ne sont
// pas partis n'a rien à recouvrer. null s'il n'y a ni l'une ni l'autre.
export function choisirPeriodeEnCours<T extends PeriodeCandidate>(periodes: T[], aujourdhui: string): T | null {
  const parDebut = (a: T, b: T) => joursEntre(b.dateDebut, a.dateDebut);
  const emises = periodes.filter((p) => p.emise).sort(parDebut);
  if (emises.length > 0) return emises[emises.length - 1]!;
  const aVenir = periodes.filter((p) => joursEntre(aujourdhui, p.dateDebut) > 0).sort(parDebut);
  return aVenir[0] ?? null;
}
