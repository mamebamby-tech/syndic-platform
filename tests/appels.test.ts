import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";
import { anomaliesContact } from "../lib/data/anomalie-contact";

// Génération des appels de fonds (app.generer_appels) et détection des
// anomalies de contact, contre le jeu de données de référence Mamelles
// Tower. Le budget de test est créé et détruit par ce fichier : le seed
// lui-même n'a que des postes à zéro (docs/06-decisions.md, question
// ouverte n°4 — les montants réels ne sont pas connus).

describe("anomaliesContact — fonction pure", () => {
  it("ne signale rien pour un contact complet et valide", () => {
    expect(anomaliesContact({ email: "a@example.com", telephone: "+221700000000" })).toEqual([]);
  });

  it("signale l'absence de téléphone", () => {
    expect(anomaliesContact({ email: "a@example.com", telephone: null })).toEqual([
      "telephone_absent",
    ]);
  });

  it("signale l'absence d'adresse électronique", () => {
    expect(anomaliesContact({ email: null, telephone: "+221700000000" })).toEqual([
      "email_absent",
    ]);
  });

  it("signale une adresse électronique sans arobase comme invalide", () => {
    expect(anomaliesContact({ email: "kaneousmane441", telephone: "+221700000000" })).toEqual([
      "email_invalide",
    ]);
  });

  it("cumule les anomalies quand plusieurs s'appliquent", () => {
    expect(anomaliesContact({ email: null, telephone: null })).toEqual([
      "telephone_absent",
      "email_absent",
    ]);
  });
});

describe("intégration — base Mamelles Tower", () => {
  let client: Client;
  let immeubleId: string;

  beforeAll(async () => {
    client = await connecter();
    const { rows } = await client.query<{ id: string }>(
      `select id from immeubles where nom = 'Mamelles Tower'`,
    );
    const immeuble = rows[0];
    if (!immeuble) {
      throw new Error("Immeuble 'Mamelles Tower' introuvable : le seed a-t-il été chargé ?");
    }
    immeubleId = immeuble.id;
  });

  afterAll(async () => {
    await client.end();
  });

  it("détecte exactement les 4 anomalies de contact connues du seed", async () => {
    const { rows } = await client.query<{ email: string | null; telephone: string | null }>(
      `select email, telephone from proprietaires
       where immeuble_id = $1 and est_groupe = false`,
      [immeubleId],
    );

    expect(rows).toHaveLength(21);

    const bloques = rows.filter((ligne) => anomaliesContact(ligne).length > 0);
    expect(bloques).toHaveLength(4);
  });

  describe("app.generer_appels — génération d'une période", () => {
    let exerciceId: string;
    let periodeId: string;
    let posteIds: string[];
    const montantsTest = [450_000.0, 275_500.5, 89_999.99];

    beforeAll(async () => {
      const { rows: postes } = await client.query<{ id: string }>(
        `select pc.id
         from postes_charges pc
         join cles_repartition cr on cr.id = pc.cle_repartition_id
         where pc.immeuble_id = $1 and cr.code = 'tantiemes' and pc.categorie = 'general'
         order by pc.ordre
         limit 3`,
        [immeubleId],
      );
      posteIds = postes.map((poste) => poste.id);
      expect(posteIds).toHaveLength(3);

      const exercice = await client.query<{ id: string }>(
        `insert into exercices (immeuble_id, libelle, date_debut, date_fin)
         values ($1, 'Exercice de test', '2027-01-01', '2027-12-31')
         returning id`,
        [immeubleId],
      );
      exerciceId = exercice.rows[0]!.id;

      const periode = await client.query<{ id: string }>(
        `insert into periodes (exercice_id, libelle, date_debut, date_fin, date_echeance, statut)
         values ($1, 'Période de test', '2027-01-01', '2027-03-31', '2027-01-01', 'brouillon')
         returning id`,
        [exerciceId],
      );
      periodeId = periode.rows[0]!.id;

      for (let index = 0; index < posteIds.length; index += 1) {
        await client.query(
          `insert into budget_lignes (periode_id, poste_charge_id, montant) values ($1, $2, $3)`,
          [periodeId, posteIds[index], montantsTest[index]],
        );
      }

      await client.query(`select app.generer_appels($1)`, [periodeId]);
    });

    afterAll(async () => {
      // La suppression de l'exercice entraîne en cascade périodes,
      // budget_lignes, appels et appel_lignes créés par ce test.
      await client.query(`delete from exercices where id = $1`, [exerciceId]);
    });

    it("répartit le budget de la période sans écart au centime", async () => {
      const { rows: budget } = await client.query<{ total: string }>(
        `select sum(montant) as total from budget_lignes where periode_id = $1`,
        [periodeId],
      );
      const { rows: appelsGeneres } = await client.query<{ total: string }>(
        `select sum(montant_total) as total from appels where periode_id = $1`,
        [periodeId],
      );

      const totalBudget = Number(budget[0]!.total);
      const totalAppels = Number(appelsGeneres[0]!.total);
      expect(Math.round(totalAppels * 100)).toBe(Math.round(totalBudget * 100));
    });

    it("adresse un seul appel à un propriétaire multi-lots non groupé", async () => {
      const { rows } = await client.query<{ id: string; nom: string; lots: number }>(
        `select p.nom, count(*) as lots
         from lots l
         join lot_proprietaires lp on lp.lot_id = l.id and lp.date_fin is null
         join proprietaires p on p.id = lp.proprietaire_id
         where l.immeuble_id = $1 and p.est_groupe = false
         group by p.nom
         order by lots desc
         limit 1`,
        [immeubleId],
      );
      const plusGrosNonGroupe = rows[0]!;
      expect(Number(plusGrosNonGroupe.lots)).toBeGreaterThan(1);

      const { rows: appelsDuProprietaire } = await client.query<{ id: string }>(
        `select a.id from appels a
         join proprietaires p on p.id = a.proprietaire_id
         where a.periode_id = $1 and p.nom = $2`,
        [periodeId, plusGrosNonGroupe.nom],
      );
      expect(appelsDuProprietaire).toHaveLength(1);

      const { rows: lignes } = await client.query<{ n: string }>(
        `select count(*) as n from appel_lignes where appel_id = $1`,
        [appelsDuProprietaire[0]!.id],
      );
      expect(Number(lignes[0]!.n)).toBe(Number(plusGrosNonGroupe.lots) * posteIds.length);
    });

    it("adresse un seul appel au groupe pour ses 22 lots", async () => {
      const { rows: appelsDuGroupe } = await client.query<{ id: string }>(
        `select a.id from appels a
         join proprietaires p on p.id = a.proprietaire_id
         where a.periode_id = $1 and p.est_groupe = true`,
        [periodeId],
      );
      expect(appelsDuGroupe).toHaveLength(1);

      const { rows: lignes } = await client.query<{ n: string }>(
        `select count(*) as n from appel_lignes where appel_id = $1`,
        [appelsDuGroupe[0]!.id],
      );
      expect(Number(lignes[0]!.n)).toBe(22 * posteIds.length);
    });

    it("bloque les destinataires dont le contact est en anomalie", async () => {
      const { rows: appelsAvecContact } = await client.query<{
        id: string;
        email: string | null;
        telephone: string | null;
      }>(
        `select a.id, p.email, p.telephone
         from appels a
         join proprietaires p on p.id = a.proprietaire_id
         where a.periode_id = $1`,
        [periodeId],
      );

      const bloques = appelsAvecContact.filter(
        (appel) => anomaliesContact(appel).length > 0,
      );
      // Les 4 anomalies connues du seed (lots 14, 26, 32, 48) doivent
      // apparaître comme destinataires bloqués sur une génération complète.
      expect(bloques).toHaveLength(4);
    });
  });
});
