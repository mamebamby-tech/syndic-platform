import { describe, expect, it } from "vitest";
import {
  appelCompte,
  appelsPayables,
  calculerTotaux,
  composerMouvements,
  somme,
  STATUTS_APPEL_COMPTES,
  type AppelBrut,
  type PaiementBrut,
} from "@/lib/releve/calcul";

// Le calcul du relevé, sans base. Le scénario complet (annuler, régénérer, réémettre, sur
// de vraies données) est dans tests/paiements.test.ts.

const appel = (id: string, statut: AppelBrut["statut"], montant: number, reference = `MT-${id}`): AppelBrut => ({
  id,
  reference,
  montant_total: montant,
  statut,
  date_echeance: "2031-01-01",
  periode_id: "periode",
});
const paiement = (id: string, appelId: string, montant: number, extra: Partial<PaiementBrut> = {}): PaiementBrut => ({
  id,
  appel_id: appelId,
  montant,
  moyen: "virement",
  statut: "confirme",
  date_paiement: "2031-01-10T00:00:00Z",
  reference_externe: null,
  annule_paiement_id: null,
  motif: null,
  ...extra,
});

describe("le total appelé ne compte que les appels émis, partiellement payés ou soldés", () => {
  it("les statuts qui comptent, et eux seuls", () => {
    expect([...STATUTS_APPEL_COMPTES]).toEqual(["emis", "partiel", "solde"]);
    expect(appelCompte("brouillon")).toBe(false);
    expect(appelCompte("annule")).toBe(false);
  });

  it("un brouillon et un appel annulé ne comptent pas", () => {
    const appels = [appel("a", "emis", 1000), appel("b", "partiel", 2000), appel("c", "solde", 4000), appel("d", "brouillon", 8000), appel("e", "annule", 16000)];
    expect(calculerTotaux(appels, []).totalAppele).toBe(7000);
  });

  it("annuler puis réémettre : l'ancien appel annulé et le nouveau ne se cumulent pas", () => {
    const avant = [appel("ancien", "emis", 50000)];
    expect(calculerTotaux(avant, []).totalAppele).toBe(50000);
    const apres = [appel("ancien", "annule", 50000), appel("nouveau", "emis", 50000)];
    expect(calculerTotaux(apres, []).totalAppele).toBe(50000);
    // Plusieurs cycles : toujours un seul appel actif.
    const encore = [appel("v1", "annule", 50000), appel("v2", "annule", 50000), appel("v3", "emis", 50000)];
    expect(calculerTotaux(encore, []).totalAppele).toBe(50000);
  });

  it("le total payé additionne les paiements confirmés, annulations (négatives) comprises", () => {
    const p = paiement("p1", "a", 1000);
    const inverse = paiement("p2", "a", -1000, { annule_paiement_id: "p1", motif: "erreur" });
    const t = calculerTotaux([appel("a", "partiel", 5000)], [p, paiement("p3", "a", 300), inverse]);
    expect(t).toEqual({ totalAppele: 5000, totalPaye: 300, solde: 4700 });
  });

  it("un paiement non confirmé ne compte pas", () => {
    const t = calculerTotaux([appel("a", "emis", 5000)], [paiement("p", "a", 1000, { statut: "en_attente" })]);
    expect(t.totalPaye).toBe(0);
  });

  it("additionne en centimes : pas de dérive de flottant", () => {
    expect(somme([0.1, 0.2])).toBe(0.3);
    expect(somme([1000.1, 2000.2, -3000.3])).toBe(0);
  });
});

describe("les mouvements", () => {
  it("un brouillon n'apparaît pas ; un appel annulé apparaît, marqué non compté", () => {
    const m = composerMouvements([appel("a", "brouillon", 1), appel("b", "annule", 2), appel("c", "emis", 3)], [], new Map());
    const appels = m.filter((x) => x.type === "appel");
    expect(appels).toHaveLength(2);
    expect(appels.find((x) => x.type === "appel" && x.statut === "annule")).toMatchObject({ compte: false });
    expect(appels.find((x) => x.type === "appel" && x.statut === "emis")).toMatchObject({ compte: true });
  });

  it("seul un paiement d'origine non annulé est annulable", () => {
    const m = composerMouvements(
      [appel("a", "partiel", 5000, "MT-2031T1-001")],
      [
        paiement("p1", "a", 1000),
        paiement("p2", "a", -1000, { annule_paiement_id: "p1", motif: "doublon" }),
        paiement("p3", "a", 200),
      ],
      new Map(),
    );
    const paiements = m.filter((x) => x.type === "paiement");
    const par = (id: string) => paiements.find((x) => x.type === "paiement" && x.id === id);
    expect(par("p1")).toMatchObject({ annulable: false, dejaAnnule: true, appelReference: "MT-2031T1-001" });
    expect(par("p2")).toMatchObject({ annulable: false, annulation: true, motif: "doublon" });
    expect(par("p3")).toMatchObject({ annulable: true, dejaAnnule: false });
  });
});

describe("les appels sur lesquels on peut encore payer", () => {
  it("émis ou partiels, avec un reste dû ; jamais brouillon, annulé ni soldé", () => {
    const appels = [appel("a", "emis", 1000, "A"), appel("b", "partiel", 2000, "B"), appel("c", "solde", 500, "C"), appel("d", "brouillon", 9, "D"), appel("e", "annule", 9, "E")];
    const payables = appelsPayables(appels, [paiement("p", "b", 500)]);
    expect(payables).toEqual([
      { id: "a", reference: "A", montantTotal: 1000, resteDu: 1000 },
      { id: "b", reference: "B", montantTotal: 2000, resteDu: 1500 },
    ]);
  });

  it("un appel entièrement payé n'est plus proposé, même s'il porte encore le statut partiel", () => {
    expect(appelsPayables([appel("a", "partiel", 1000)], [paiement("p", "a", 1000)])).toEqual([]);
  });
});
