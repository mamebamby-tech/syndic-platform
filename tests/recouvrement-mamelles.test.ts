import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";
import { essayer } from "./aides";
import {
  calculerRecouvrement,
  calculerRetards,
  listerRetards,
  repartirParTranche,
  situationDesAppels,
} from "@/lib/recouvrement/calcul";

// Le tableau de bord sur le jeu de référence (supabase/seed/seed.sql), au
// 26 septembre 2026 : date FIXE, pour que le test ne dépende pas du jour où il
// tourne. Les mêmes chiffres que ceux que le seed contrôle à son chargement,
// cette fois passés par le calcul de l'écran.

const AUJOURDHUI = "2026-09-26";

describe("recouvrement — jeu Mamelles Tower au 26/09/2026", () => {
  let client: Client;
  let immeubleId: string;
  let bornes: number[];
  let situations: ReturnType<typeof situationDesAppels>;
  let periodeT4: string;

  beforeAll(async () => {
    client = await connecter();
    const { rows: immeuble } = await client.query<{ id: string; bornes_anciennete_jours: number[] }>(
      `select id, bornes_anciennete_jours from immeubles where nom = 'Mamelles Tower'`,
    );
    if (!immeuble[0]) throw new Error("Immeuble 'Mamelles Tower' introuvable : le seed a-t-il été chargé ?");
    immeubleId = immeuble[0].id;
    bornes = immeuble[0].bornes_anciennete_jours;

    // Les périodes du seed seulement : d'autres fichiers de tests en créent.
    const { rows: appels } = await client.query(
      `select a.id, a.proprietaire_id as "proprietaireId", a.periode_id as "periodeId",
              a.montant_total::float8 as "montantTotal", a.date_echeance::text as "dateEcheance", a.statut,
              per.libelle
       from appels a join periodes per on per.id = a.periode_id
       join exercices e on e.id = per.exercice_id
       where e.immeuble_id = $1 and e.libelle = 'Exercice 2026'`,
      [immeubleId],
    );
    periodeT4 = appels.find((a) => a.libelle === "4e trimestre 2026")!.periodeId;
    const { rows: paiements } = await client.query(
      `select appel_id as "appelId", montant::float8 as montant, statut from paiements where appel_id = any($1)`,
      [appels.map((a) => a.id)],
    );
    situations = situationDesAppels(appels, paiements, AUJOURDHUI);
  });

  afterAll(async () => {
    await client.end();
  });

  it("les tranches par défaut sont 30, 60 et 90 jours", () => {
    expect(bornes).toEqual([30, 60, 90]);
  });

  it("4e trimestre : 4 800 000 FCFA appelés, 2 967 280 encaissés (61 %), 1 832 720 à échoir", () => {
    const r = calculerRecouvrement(situations.filter((s) => s.periodeId === periodeT4));
    expect(r).toMatchObject({ nombreAppels: 19, appele: 4_800_000, encaisse: 2_967_280, resteDu: 1_832_720, tropPercu: 0 });
    expect(Math.floor(r.taux! * 100)).toBe(61);
  });

  it("quatre propriétaires en retard sur le 2e et le 3e trimestre, dont un gros porteur", () => {
    expect(calculerRetards(situations)).toEqual({ nombreProprietaires: 4, montant: 1_218_000 });
  });

  it("la carte des retards : NDIAYE HOLDING d'abord (178 jours, le plus gros montant), Tarik OZTURK en dernier (87 jours)", async () => {
    const { rows } = await client.query<{ id: string; nom: string }>(
      `select id, nom from proprietaires where immeuble_id = $1`,
      [immeubleId],
    );
    const nom = new Map(rows.map((r) => [r.id, r.nom]));
    const lignes = listerRetards(situations).map((r) => [nom.get(r.proprietaireId), r.montantEchu, r.joursRetardMax]);
    expect(lignes[0]).toEqual(["NDIAYE HOLDING", 1_016_400, 178]);
    expect(lignes.slice(1, 3)).toEqual(
      expect.arrayContaining([
        ["SCI BAOBAB", 71_520, 178],
        ["Ousmane KANE (remplacement A. SECK)", 71_520, 178],
      ]),
    );
    expect(lignes[3]).toEqual(["Tarik OZTURK", 58_560, 87]);
    expect(lignes).toHaveLength(4);
  });

  it("à échoir, 61-90 et au-delà de 90 jours sont peuplés ; 1-30 et 31-60 vides (échéances trimestrielles)", () => {
    const parCle = Object.fromEntries(
      repartirParTranche(situations, bornes).map((r) => [r.tranche.cle, [r.montant, r.nombreAppels]]),
    );
    expect(parCle).toEqual({
      "a-echoir": [1_832_720, 10],
      "1-30": [0, 0],
      "31-60": [0, 0],
      "61-90": [566_760, 2],
      "91-plus": [651_240, 3],
    });
    // 3 050 720 FCFA restant dus au total, comme le contrôle du seed.
    expect(Object.values(parCle).reduce((s, [m]) => s + m!, 0)).toBe(3_050_720);
  });

  it("la base refuse des bornes invalides", async () => {
    await client.query("begin");
    try {
      for (const bornes of ["{}", "{0,30}", "{30,30}", "{60,30}", "{30,null}"]) {
        const r = await essayer(client, `update immeubles set bornes_anciennete_jours = $1 where id = $2`, [
          bornes,
          immeubleId,
        ]);
        expect(r.erreur, bornes).toMatch(/immeubles_bornes_anciennete_valides/);
      }
      const r = await essayer(client, `update immeubles set bornes_anciennete_jours = '{15,45}' where id = $1`, [
        immeubleId,
      ]);
      expect(r.erreur).toBeNull();
    } finally {
      await client.query("rollback");
    }
  });
});
