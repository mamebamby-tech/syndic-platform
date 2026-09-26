import { describe, expect, it } from "vitest";
import {
  BornesAncienneteInvalides,
  calculerRecouvrement,
  calculerRetards,
  choisirPeriodeEnCours,
  comptesParProprietaire,
  joursEntre,
  listerRetards,
  repartirParTranche,
  situationDesAppels,
  trancheDe,
  tranchesAnciennete,
  type AppelRecouvrement,
  type PaiementRecouvrement,
} from "@/lib/recouvrement/calcul";

// Tests sans base de données : le calcul du recouvrement et des tranches
// d'ancienneté du tableau de bord (lib/recouvrement/calcul.ts).

const BORNES = [30, 60, 90];
const AUJOURDHUI = "2026-09-26";

let numero = 0;
const appel = (partiel: Partial<AppelRecouvrement> = {}): AppelRecouvrement => ({
  id: `a${++numero}`,
  proprietaireId: "p1",
  periodeId: "t4",
  montantTotal: 100_000,
  dateEcheance: "2026-10-01",
  statut: "emis",
  ...partiel,
});
const paiement = (appelId: string, montant: number, statut: PaiementRecouvrement["statut"] = "confirme") => ({
  appelId,
  montant,
  statut,
});

describe("joursEntre", () => {
  it("compte les jours de calendrier, en UTC", () => {
    expect(joursEntre("2026-07-01", "2026-09-26")).toBe(87);
    expect(joursEntre("2026-10-01", "2026-09-26")).toBe(-5);
    expect(joursEntre("2026-09-26", "2026-09-26")).toBe(0);
    // Passage à l'heure d'hiver en Europe : sans effet sur un calcul en UTC.
    expect(joursEntre("2026-10-24", "2026-10-26")).toBe(2);
  });
});

describe("recouvrement d'une période", () => {
  it("aucun appel émis : rien d'appelé, et un taux absent plutôt que 0 %", () => {
    expect(calculerRecouvrement(situationDesAppels([], [], AUJOURDHUI))).toEqual({
      nombreAppels: 0,
      appele: 0,
      encaisse: 0,
      resteDu: 0,
      tropPercu: 0,
      taux: null,
    });
  });

  it("des brouillons et des appels annulés ne sont pas appelés", () => {
    const appels = [appel({ statut: "brouillon" }), appel({ statut: "annule" })];
    const r = calculerRecouvrement(situationDesAppels(appels, [], AUJOURDHUI));
    expect(r.appele).toBe(0);
    expect(r.taux).toBeNull();
  });

  it("tout soldé : 100 %, rien à recouvrer, aucune tranche peuplée", () => {
    const a = appel({ statut: "solde" });
    const b = appel({ statut: "solde", proprietaireId: "p2", montantTotal: 250_000 });
    const situations = situationDesAppels([a, b], [paiement(a.id, 100_000), paiement(b.id, 250_000)], AUJOURDHUI);
    expect(calculerRecouvrement(situations)).toMatchObject({ appele: 350_000, encaisse: 350_000, resteDu: 0, taux: 1 });
    expect(repartirParTranche(situations, BORNES).every((t) => t.montant === 0 && t.nombreAppels === 0)).toBe(true);
    expect(calculerRetards(situations)).toEqual({ nombreProprietaires: 0, montant: 0 });
  });

  it("un paiement supérieur à l'appel : le reste dû est nul, pas négatif, et l'excédent n'éteint pas une autre dette", () => {
    const a = appel({ statut: "solde" });
    const b = appel({ proprietaireId: "p1", dateEcheance: "2026-07-01" });
    const situations = situationDesAppels([a, b], [paiement(a.id, 130_000)], AUJOURDHUI);
    const r = calculerRecouvrement(situations);
    expect(r).toMatchObject({ appele: 200_000, encaisse: 100_000, resteDu: 100_000, tropPercu: 30_000, taux: 0.5 });
    // Appelé = encaissé + reste dû, toujours.
    expect(r.encaisse + r.resteDu).toBe(r.appele);
    expect(situations.find((s) => s.appelId === a.id)).toMatchObject({ resteDu: 0, tropPercu: 30_000 });
    expect(calculerRetards(situations)).toEqual({ nombreProprietaires: 1, montant: 100_000 });
  });

  it("le taux ne dépasse jamais 100 %", () => {
    const a = appel();
    expect(calculerRecouvrement(situationDesAppels([a], [paiement(a.id, 1_000_000)], AUJOURDHUI)).taux).toBe(1);
  });

  it("additionne au centime, sans erreur de flottant", () => {
    const a = appel({ montantTotal: 0.3 });
    const r = calculerRecouvrement(situationDesAppels([a], [paiement(a.id, 0.1), paiement(a.id, 0.2)], AUJOURDHUI));
    expect(r).toMatchObject({ appele: 0.3, encaisse: 0.3, resteDu: 0, tropPercu: 0 });
  });

  it("une annulation compense son paiement ; un paiement non confirmé ne compte pas", () => {
    const a = appel();
    const paiements = [
      paiement(a.id, 40_000),
      paiement(a.id, -40_000),
      paiement(a.id, 25_000),
      paiement(a.id, 50_000, "en_attente"),
      paiement(a.id, 50_000, "echoue"),
    ];
    expect(calculerRecouvrement(situationDesAppels([a], paiements, AUJOURDHUI))).toMatchObject({
      encaisse: 25_000,
      resteDu: 75_000,
    });
  });
});

describe("tranches d'ancienneté", () => {
  it("se déduisent des bornes de l'immeuble : à échoir, 1-30, 31-60, 61-90, au-delà", () => {
    expect(tranchesAnciennete(BORNES)).toEqual([
      { cle: "a-echoir", min: null, max: 0 },
      { cle: "1-30", min: 1, max: 30 },
      { cle: "31-60", min: 31, max: 60 },
      { cle: "61-90", min: 61, max: 90 },
      { cle: "91-plus", min: 91, max: null },
    ]);
  });

  it("d'autres bornes donnent d'autres tranches : rien n'est écrit en dur", () => {
    expect(tranchesAnciennete([15, 45]).map((t) => t.cle)).toEqual(["a-echoir", "1-15", "16-45", "46-plus"]);
    expect(tranchesAnciennete([30]).map((t) => t.cle)).toEqual(["a-echoir", "1-30", "31-plus"]);
  });

  it("chaque jour tombe dans une seule tranche, bornes comprises", () => {
    const tranches = tranchesAnciennete(BORNES);
    const cle = (jours: number) => trancheDe(jours, tranches).cle;
    expect([-40, -1, 0].map(cle)).toEqual(["a-echoir", "a-echoir", "a-echoir"]);
    expect([1, 30].map(cle)).toEqual(["1-30", "1-30"]);
    expect([31, 60].map(cle)).toEqual(["31-60", "31-60"]);
    expect([61, 90].map(cle)).toEqual(["61-90", "61-90"]);
    expect([91, 4000].map(cle)).toEqual(["91-plus", "91-plus"]);
  });

  it("refuse des bornes vides, nulles, non entières ou non strictement croissantes", () => {
    for (const bornes of [[], [0], [-5], [1.5], [30, 30], [60, 30]]) {
      expect(() => tranchesAnciennete(bornes), JSON.stringify(bornes)).toThrow(BornesAncienneteInvalides);
    }
  });

  it("aucun appel : toutes les tranches existent, à zéro", () => {
    const repartition = repartirParTranche([], BORNES);
    expect(repartition).toHaveLength(5);
    expect(repartition.every((r) => r.montant === 0)).toBe(true);
  });

  it("compte des appels, pas des propriétaires : un propriétaire en retard sur deux trimestres compte dans deux tranches", () => {
    const situations = situationDesAppels(
      [
        appel({ proprietaireId: "p1", dateEcheance: "2026-04-01" }), // 178 j
        appel({ proprietaireId: "p1", dateEcheance: "2026-07-01" }), // 87 j
        appel({ proprietaireId: "p2", dateEcheance: "2026-07-01" }), // 87 j
      ],
      [],
      AUJOURDHUI,
    );
    const appels = Object.fromEntries(repartirParTranche(situations, BORNES).map((r) => [r.tranche.cle, r.nombreAppels]));
    expect(appels).toMatchObject({ "61-90": 2, "91-plus": 1 });
    // Trois appels dans les tranches, mais deux propriétaires en retard.
    expect(calculerRetards(situations).nombreProprietaires).toBe(2);
  });

  it("range le reste dû de chaque appel selon son échéance ; un propriétaire peut peupler deux tranches", () => {
    const appels = [
      appel({ proprietaireId: "p1", dateEcheance: "2026-10-01", montantTotal: 100_000 }), // à échoir
      appel({ proprietaireId: "p1", dateEcheance: "2026-07-01", montantTotal: 80_000 }), // 87 j
      appel({ proprietaireId: "p2", dateEcheance: "2026-09-26", montantTotal: 10_000 }), // échéance aujourd'hui
      appel({ proprietaireId: "p3", dateEcheance: "2026-09-25", montantTotal: 20_000 }), // 1 j
      appel({ proprietaireId: "p4", dateEcheance: "2026-08-27", montantTotal: 30_000 }), // 30 j
      appel({ proprietaireId: "p5", dateEcheance: "2026-08-26", montantTotal: 40_000 }), // 31 j
      appel({ proprietaireId: "p6", dateEcheance: "2026-06-27", montantTotal: 50_000 }), // 91 j
    ];
    const partiel = appels[1]!;
    const situations = situationDesAppels(appels, [paiement(partiel.id, 30_000)], AUJOURDHUI);
    const parCle = Object.fromEntries(
      repartirParTranche(situations, BORNES).map((r) => [r.tranche.cle, [r.montant, r.nombreAppels]]),
    );
    expect(parCle).toEqual({
      "a-echoir": [110_000, 2],
      "1-30": [50_000, 2],
      "31-60": [40_000, 1],
      "61-90": [50_000, 1],
      "91-plus": [50_000, 1],
    });
    // Le total des tranches est le reste dû : rien ne se perd, rien ne double.
    const total = Object.values(parCle).reduce((s, [m]) => s + m!, 0);
    expect(total).toBe(calculerRecouvrement(situations).resteDu);
  });
});

describe("propriétaires en retard", () => {
  it("en retard dès le lendemain de l'échéance, pas le jour même", () => {
    const aujourdhuiEcheance = appel({ proprietaireId: "p1", dateEcheance: "2026-09-26" });
    const hierEcheance = appel({ proprietaireId: "p2", dateEcheance: "2026-09-25" });
    const situations = situationDesAppels([aujourdhuiEcheance, hierEcheance], [], AUJOURDHUI);
    expect(calculerRetards(situations)).toEqual({ nombreProprietaires: 1, montant: 100_000 });
  });

  it("un propriétaire en retard sur deux appels compte une fois, pour la somme des deux", () => {
    const situations = situationDesAppels(
      [appel({ dateEcheance: "2026-04-01" }), appel({ dateEcheance: "2026-07-01" })],
      [],
      AUJOURDHUI,
    );
    expect(calculerRetards(situations)).toEqual({ nombreProprietaires: 1, montant: 200_000 });
  });
});

describe("liste des propriétaires en retard", () => {
  it("un propriétaire par ligne : son échu cumulé et son plus ancien retard, le plus ancien d'abord", () => {
    const solde = appel({ proprietaireId: "solde", dateEcheance: "2026-04-01", statut: "solde" });
    const situations = situationDesAppels(
      [
        appel({ proprietaireId: "recent", dateEcheance: "2026-09-20", montantTotal: 500_000 }), // 6 j
        appel({ proprietaireId: "ancien", dateEcheance: "2026-07-01", montantTotal: 10_000 }), // 87 j
        appel({ proprietaireId: "ancien", dateEcheance: "2026-04-01", montantTotal: 20_000 }), // 178 j
        appel({ proprietaireId: "egal-petit", dateEcheance: "2026-04-01", montantTotal: 5_000 }), // 178 j
        appel({ proprietaireId: "a-echoir", dateEcheance: "2026-10-01" }), // pas en retard
        solde,
      ],
      [paiement(solde.id, 100_000)],
      AUJOURDHUI,
    );
    expect(listerRetards(situations)).toEqual([
      { proprietaireId: "ancien", montantEchu: 30_000, joursRetardMax: 178 },
      { proprietaireId: "egal-petit", montantEchu: 5_000, joursRetardMax: 178 },
      { proprietaireId: "recent", montantEchu: 500_000, joursRetardMax: 6 },
    ]);
  });

  it("aucun retard : liste vide", () => {
    expect(listerRetards(situationDesAppels([appel()], [], AUJOURDHUI))).toEqual([]);
  });
});

describe("comptes par propriétaire", () => {
  it("statut de la période, reste dû total, part échue, plus ancien retard", () => {
    const t4 = appel({ proprietaireId: "p1", periodeId: "t4", dateEcheance: "2026-10-01" });
    const t3 = appel({ proprietaireId: "p1", periodeId: "t3", dateEcheance: "2026-07-01" });
    const t4b = appel({ proprietaireId: "p2", periodeId: "t4", dateEcheance: "2026-10-01" });
    const t3b = appel({ proprietaireId: "p3", periodeId: "t3", dateEcheance: "2026-07-01", statut: "solde" });
    const situations = situationDesAppels(
      [t4, t3, t4b, t3b],
      [paiement(t4.id, 40_000), paiement(t4b.id, 100_000), paiement(t3b.id, 100_000)],
      AUJOURDHUI,
    );
    const comptes = comptesParProprietaire(situations, "t4", BORNES);

    expect(comptes.get("p1")).toEqual({
      proprietaireId: "p1",
      periode: { appele: 100_000, paye: 40_000, resteDu: 60_000, statut: "partiel" },
      resteDuTotal: 160_000,
      resteDuEchu: 100_000,
      clesTranches: ["a-echoir", "61-90"],
      joursRetardMax: 87,
    });
    expect(comptes.get("p2")).toMatchObject({
      periode: { statut: "solde", resteDu: 0 },
      resteDuTotal: 0,
      clesTranches: [],
      joursRetardMax: null,
    });
    // Pas d'appel sur la période en cours : pas de statut de période.
    expect(comptes.get("p3")?.periode).toBeNull();
  });

  it("sans période en cours, aucun compte n'a de statut de période", () => {
    const situations = situationDesAppels([appel()], [], AUJOURDHUI);
    expect(comptesParProprietaire(situations, null, BORNES).get("p1")?.periode).toBeNull();
  });
});

describe("période en cours (décision 67)", () => {
  const periode = (id: string, dateDebut: string, emise: boolean) => ({ id, dateDebut, emise });

  it("une période récemment émise et une antérieure impayée : la période en cours est la plus récente émise, et les arriérés de l'ancienne ne vont qu'à l'ancienneté", () => {
    const periodes = [
      periode("t3", "2026-07-01", true),
      periode("t4", "2026-10-01", true),
      // Le trimestre suivant, en préparation : pas émis, jamais « en cours ».
      periode("t1-2027", "2027-01-01", false),
    ];
    const enCours = choisirPeriodeEnCours(periodes, AUJOURDHUI);
    expect(enCours?.id).toBe("t4");

    const t3 = appel({ proprietaireId: "p1", periodeId: "t3", dateEcheance: "2026-07-01", montantTotal: 80_000 });
    const t4 = appel({ proprietaireId: "p1", periodeId: "t4", dateEcheance: "2026-10-01", montantTotal: 100_000 });
    const t4b = appel({ proprietaireId: "p2", periodeId: "t4", dateEcheance: "2026-10-01", montantTotal: 100_000, statut: "solde" });
    const situations = situationDesAppels([t3, t4, t4b], [paiement(t4b.id, 100_000)], AUJOURDHUI);

    // Le recouvrement de la période en cours ignore les 80 000 FCFA du 3e trimestre…
    expect(calculerRecouvrement(situations.filter((s) => s.periodeId === enCours!.id))).toMatchObject({
      appele: 200_000,
      encaisse: 100_000,
      resteDu: 100_000,
    });
    // …qui sont dans l'ancienneté, toutes périodes, à 61-90 jours.
    const parCle = Object.fromEntries(repartirParTranche(situations, BORNES).map((r) => [r.tranche.cle, r.montant]));
    expect(parCle).toMatchObject({ "a-echoir": 100_000, "61-90": 80_000 });
  });

  it("jamais la période qui contient la date du jour : une période en cours de calendrier mais non émise n'est pas retenue", () => {
    const periodes = [periode("t2", "2026-04-01", true), periode("t3", "2026-07-01", false)];
    expect(choisirPeriodeEnCours(periodes, AUJOURDHUI)?.id).toBe("t2");
  });

  it("aucune période émise : la prochaine à venir, pas celle qui contient la date du jour", () => {
    const periodes = [
      periode("t3", "2026-07-01", false),
      periode("t1-2027", "2027-01-01", false),
      periode("t4", "2026-10-01", false),
    ];
    expect(choisirPeriodeEnCours(periodes, AUJOURDHUI)?.id).toBe("t4");
  });

  it("aucune période émise ni à venir : aucune période en cours", () => {
    expect(choisirPeriodeEnCours([periode("t3", "2026-07-01", false)], AUJOURDHUI)).toBeNull();
    expect(choisirPeriodeEnCours([], AUJOURDHUI)).toBeNull();
  });

  it("une période qui commence aujourd'hui n'est pas « à venir »", () => {
    expect(choisirPeriodeEnCours([periode("t4", AUJOURDHUI, false)], AUJOURDHUI)).toBeNull();
  });
});
