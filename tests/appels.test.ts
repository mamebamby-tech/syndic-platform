import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";
import { anomaliesContact, canauxDisponibles, etatEnvoi } from "../lib/data/anomalie-contact";
import { codePeriode, rendreReference } from "../lib/parametres/reference";

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

describe("état d'envoi par canal — fonction pure", () => {
  const complet = { email: "a@example.com", telephone: "+221700000000" };

  it("prêt : les deux canaux", () => {
    expect(etatEnvoi(complet)).toBe("pret");
    expect(canauxDisponibles(complet)).toEqual({ whatsapp: true, courriel: true });
  });

  it("WhatsApp seulement : adresse électronique absente", () => {
    expect(etatEnvoi({ ...complet, email: null })).toBe("whatsapp_seulement");
  });

  it("WhatsApp seulement : adresse électronique invalide", () => {
    expect(etatEnvoi({ ...complet, email: "kaneousmane441" })).toBe("whatsapp_seulement");
    expect(canauxDisponibles({ ...complet, email: "kaneousmane441" }).courriel).toBe(false);
  });

  it("courriel seulement : numéro WhatsApp absent", () => {
    expect(etatEnvoi({ ...complet, telephone: null })).toBe("courriel_seulement");
  });

  it("injoignable : aucun canal, et seulement alors", () => {
    expect(etatEnvoi({ email: null, telephone: null })).toBe("injoignable");
    expect(etatEnvoi({ email: "sans-domaine", telephone: null })).toBe("injoignable");
  });

  it("une valeur faite d'espaces n'ouvre aucun canal", () => {
    expect(etatEnvoi({ email: "   ", telephone: "  " })).toBe("injoignable");
    expect(etatEnvoi({ email: "a@example.com", telephone: "  " })).toBe("courriel_seulement");
  });

  it("une anomalie sur un canal n'est jamais un blocage tant que l'autre est valide", () => {
    for (const contact of [
      { email: null, telephone: "+221700000000" },
      { email: "x", telephone: "+221700000000" },
      { email: "a@example.com", telephone: null },
    ]) {
      expect(anomaliesContact(contact).length).toBeGreaterThan(0);
      expect(etatEnvoi(contact)).not.toBe("injoignable");
    }
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

    const enAnomalie = rows.filter((ligne) => anomaliesContact(ligne).length > 0);
    expect(enAnomalie).toHaveLength(4);
  });

  it("aucun copropriétaire n'est injoignable : chaque anomalie laisse un canal valide", async () => {
    const { rows } = await client.query<{ email: string | null; telephone: string | null }>(
      `select email, telephone from proprietaires
       where immeuble_id = $1 and est_groupe = false`,
      [immeubleId],
    );

    const etats = rows.map((ligne) => etatEnvoi(ligne));
    const compte = (etat: string) => etats.filter((e) => e === etat).length;

    expect(compte("injoignable")).toBe(0);
    expect(compte("whatsapp_seulement") + compte("courriel_seulement")).toBe(4);
    // Lots 26 (sans adresse) et 48 (adresse invalide) : WhatsApp seulement.
    expect(compte("whatsapp_seulement")).toBe(2);
    // Lots 14 et 32 (sans numéro) : courriel seulement.
    expect(compte("courriel_seulement")).toBe(2);
    expect(compte("pret")).toBe(rows.length - 4);
  });

  describe("app.generer_appels — génération d'une période", () => {
    let exerciceId: string;
    let periodeId: string;
    // Réglages LUS, jamais supposés : syndic-dev se manipule depuis l'écran
    // Paramètres, le code de référence n'est donc pas forcément celui du seed.
    let codeImmeuble: string;
    let formatReference: string;

    // Coordonnées vides, DANS la transaction du test (annulée ensuite) : on ne
    // suppose pas l'état du seed, et on n'écrase pas les réglages de la base.
    const viderCoordonnees = () =>
      client.query(
        `update immeubles set compte_titulaire = null, compte_banque = null, compte_numero = null,
           compte_bic = null, moyens_paiement_acceptes = '{}', numeros_marchands = '{}' where id = $1`,
        [immeubleId],
      );
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

      const reglages = await client.query<{ code_reference: string; format_reference_appel: string }>(
        `select code_reference, format_reference_appel from immeubles where id = $1`,
        [immeubleId],
      );
      codeImmeuble = reglages.rows[0]!.code_reference;
      formatReference = reglages.rows[0]!.format_reference_appel;
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

    it("n'a aucun destinataire injoignable : 4 envois sur un seul canal, 0 bloqué", async () => {
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

      const parEtat = (etat: string) => appelsAvecContact.filter((a) => etatEnvoi(a) === etat);

      // Les 4 anomalies connues du seed (lots 14, 26, 32, 48) apparaissent
      // sur une génération complète comme des envois sur UN seul canal :
      // aucun destinataire n'est injoignable.
      expect(parEtat("injoignable")).toHaveLength(0);
      expect(parEtat("whatsapp_seulement")).toHaveLength(2);
      expect(parEtat("courriel_seulement")).toHaveLength(2);
      expect(appelsAvecContact.filter((a) => anomaliesContact(a).length > 0)).toHaveLength(4);

      // Le canal manquant est bien celui de l'anomalie.
      expect(parEtat("whatsapp_seulement").map((a) => anomaliesContact(a)[0]).sort()).toEqual([
        "email_absent",
        "email_invalide",
      ]);
      expect(parEtat("courriel_seulement").map((a) => anomaliesContact(a)[0])).toEqual([
        "telephone_absent",
        "telephone_absent",
      ]);
    });

    describe("références d'appel", () => {
      it("sont courtes, sans espace ni fragment d'UUID : MT-2027T1-007", async () => {
        const { rows } = await client.query<{ reference: string }>(
          `select reference from appels where periode_id = $1`,
          [periodeId],
        );
        expect(rows.length).toBe(19);
        for (const { reference } of rows) {
          expect(reference).toMatch(new RegExp(`^${codeImmeuble}-2027T1-\\d{3}$`));
          expect(reference).not.toMatch(/\s/);
          expect(reference.length).toBeLessThanOrEqual(16);
        }
      });

      it("le miroir TypeScript (aperçu du formulaire) rend exactement les références générées", async () => {
        const { rows } = await client.query<{ reference: string }>(
          `select reference from appels where periode_id = $1 order by numero`,
          [periodeId],
        );
        // La période de test commence le 2027-01-01 : trimestriel, T1.
        rows.forEach((ligne, index) => {
          expect(ligne.reference).toBe(
            rendreReference(formatReference, {
              code: codeImmeuble,
              annee: 2027,
              periode: codePeriode("trimestriel", 1),
              seq: index + 1,
            }),
          );
        });
      });

      it("sont uniques dans la période, et numérotées de 1 à N sans trou", async () => {
        const { rows } = await client.query<{ reference: string; numero: number }>(
          `select reference, numero from appels where periode_id = $1 order by numero`,
          [periodeId],
        );
        expect(new Set(rows.map((r) => r.reference)).size).toBe(rows.length);
        expect(rows.map((r) => r.numero)).toEqual(rows.map((_, i) => i + 1));
        expect(rows[0]!.reference).toBe(`${codeImmeuble}-2027T1-001`);
        expect(rows.at(-1)!.reference).toBe(`${codeImmeuble}-2027T1-019`);
      });

      it("la base refuse deux appels de même référence dans une période, et une référence avec espace", async () => {
        await client.query("begin");
        try {
          const { rows } = await client.query<{ id: string }>(
            `select id from appels where periode_id = $1 order by numero limit 2`,
            [periodeId],
          );
          await client.query("savepoint a");
          await expect(
            client.query(
              `update appels set reference = (select reference from appels where id = $1) where id = $2`,
              [rows[0]!.id, rows[1]!.id],
            ),
          ).rejects.toThrow(/appels_reference_unique_par_periode/);
          await client.query("rollback to savepoint a");
          await expect(
            client.query(`update appels set reference = 'MT 2027 T1' where id = $1`, [rows[0]!.id]),
          ).rejects.toThrow(/appels_reference_dictable/);
        } finally {
          await client.query("rollback");
        }
      });

      it("régénérer à données égales redonne les mêmes références", async () => {
        const avant = await client.query<{ p: string; reference: string }>(
          `select proprietaire_id as p, reference from appels where periode_id = $1 order by 1`,
          [periodeId],
        );
        await client.query("begin");
        try {
          await client.query(`select app.generer_appels($1)`, [periodeId]);
          const apres = await client.query<{ p: string; reference: string }>(
            `select proprietaire_id as p, reference from appels where periode_id = $1 order by 1`,
            [periodeId],
          );
          expect(apres.rows).toEqual(avant.rows);
        } finally {
          await client.query("rollback");
        }
      });

      it("le gabarit est un paramètre de l'immeuble : TOUR-{annee}-{seq}", async () => {
        await client.query("begin");
        try {
          await client.query(
            `update immeubles set format_reference_appel = 'TOUR-{annee}-{seq}' where id = $1`,
            [immeubleId],
          );
          await client.query(`select app.generer_appels($1)`, [periodeId]);
          const { rows } = await client.query<{ reference: string }>(
            `select reference from appels where periode_id = $1 order by numero`,
            [periodeId],
          );
          expect(rows[0]!.reference).toBe("TOUR-2027-001");
          for (const { reference } of rows) expect(reference).toMatch(/^TOUR-2027-\d{3}$/);
        } finally {
          await client.query("rollback");
        }
      });

      it("un appel émis garde sa référence, et la régénération ne réutilise pas son numéro", async () => {
        await client.query("begin");
        try {
          await client.query(
            `update immeubles set compte_titulaire = 'Syndicat de test', compte_banque = 'Banque de test',
                                  compte_numero = 'SN000 0000 0000' where id = $1`,
            [immeubleId],
          );
          const emis = await client.query<{ id: string; reference: string; numero: number }>(
            `update appels set statut = 'emis'
             where id = (select id from appels where periode_id = $1 order by numero limit 1)
             returning id, reference, numero`,
            [periodeId],
          );
          await client.query(`select app.generer_appels($1)`, [periodeId]);

          const { rows } = await client.query<{ id: string; reference: string; numero: number }>(
            `select id, reference, numero from appels where periode_id = $1 order by numero`,
            [periodeId],
          );
          const garde = rows.find((r) => r.id === emis.rows[0]!.id)!;
          expect(garde.reference).toBe(emis.rows[0]!.reference);
          expect(new Set(rows.map((r) => r.reference)).size).toBe(rows.length);
          expect(new Set(rows.map((r) => r.numero)).size).toBe(rows.length);
        } finally {
          await client.query("rollback");
        }
      });

      it("refuse un gabarit sans {seq}, avec espace, avec jeton inconnu, ou un code invalide", async () => {
        const essais: [string, unknown][] = [
          [`update immeubles set format_reference_appel = '{code}-{annee}' where id = $1`, /format_reference_valide/],
          [`update immeubles set format_reference_appel = '{code} {seq}' where id = $1`, /format_reference_valide/],
          [`update immeubles set format_reference_appel = '{code}-{seq}-{uuid}' where id = $1`, /format_reference_valide/],
          [`update immeubles set format_reference_appel = '{seq}/{annee}' where id = $1`, /format_reference_valide/],
          [`update immeubles set code_reference = 'mt' where id = $1`, /code_reference_format/],
          [`update immeubles set code_reference = 'M T' where id = $1`, /code_reference_format/],
          [`update immeubles set code_reference = 'TROPLONGUE' where id = $1`, /code_reference_format/],
        ];
        for (const [sql, erreur] of essais) {
          await client.query("begin");
          try {
            await expect(client.query(sql, [immeubleId]), sql).rejects.toThrow(erreur as RegExp);
          } finally {
            await client.query("rollback");
          }
        }
      });

      it("échoue nettement, sans inventer de code, quand l'immeuble n'en a pas", async () => {
        await client.query("begin");
        try {
          await client.query(`update immeubles set code_reference = null where id = $1`, [immeubleId]);
          await expect(client.query(`select app.generer_appels($1)`, [periodeId])).rejects.toThrow(
            /Code de référence non renseigné/,
          );
        } finally {
          await client.query("rollback");
        }
      });
    });

    describe("émission — pas sans coordonnées bancaires du syndicat", () => {
      const comptes = `compte_titulaire = 'Syndicat de test', compte_banque = 'Banque de test', compte_numero = 'SN000 0000 0000'`;

      const emettre = (id: string) =>
        client.query(`update appels set statut = 'emis' where id = $1`, [id]);

      it("sans coordonnées bancaires, l'émission est refusée", async () => {
        await client.query("begin");
        try {
          await viderCoordonnees();
          const { rows: a } = await client.query<{ id: string }>(
            `select id from appels where periode_id = $1 limit 1`,
            [periodeId],
          );
          await expect(emettre(a[0]!.id)).rejects.toThrow(/coordonnées bancaires du syndicat à renseigner/);
        } finally {
          await client.query("rollback");
        }
      });

      it("refuse aussi partiel et soldé, et l'insertion directe d'un appel émis", async () => {
        await client.query("begin");
        try {
          await viderCoordonnees();
          const { rows: a } = await client.query<{
            id: string;
            periode_id: string;
            proprietaire_id: string;
            date_echeance: string;
          }>(
            `select id, periode_id, proprietaire_id, date_echeance from appels
             where periode_id = $1 limit 1`,
            [periodeId],
          );
          for (const statut of ["partiel", "solde"]) {
            await client.query("savepoint s");
            await expect(
              client.query(`update appels set statut = $2 where id = $1`, [a[0]!.id, statut]),
            ).rejects.toThrow(/coordonnées bancaires/);
            await client.query("rollback to savepoint s");
          }

          // Insertion directe : on retire d'abord l'appel du même
          // destinataire, pour que seul le déclencheur d'émission puisse refuser.
          await client.query(`delete from appels where id = $1`, [a[0]!.id]);
          await expect(
            client.query(
              `insert into appels (periode_id, proprietaire_id, reference, date_echeance, statut)
               values ($1, $2, 'MT-2027T1-900', $3, 'emis')`,
              [a[0]!.periode_id, a[0]!.proprietaire_id, a[0]!.date_echeance],
            ),
          ).rejects.toThrow(/ne s'émet que depuis un brouillon/);
        } finally {
          await client.query("rollback");
        }
      });

      it("des coordonnées incomplètes ou blanches ne suffisent pas", async () => {
        for (const partiel of [
          `compte_titulaire = 'Syndicat de test', compte_banque = 'Banque de test'`,
          `compte_titulaire = 'Syndicat de test', compte_banque = 'Banque de test', compte_numero = '   '`,
          `compte_titulaire = '', compte_banque = 'Banque de test', compte_numero = 'SN000'`,
          `compte_banque = 'Banque de test', compte_numero = 'SN000'`,
        ]) {
          await client.query("begin");
          try {
            await viderCoordonnees();
            await client.query(`update immeubles set ${partiel} where id = $1`, [immeubleId]);
            const { rows: a } = await client.query<{ id: string }>(
              `select id from appels where periode_id = $1 limit 1`,
              [periodeId],
            );
            await expect(emettre(a[0]!.id), partiel).rejects.toThrow(/coordonnées bancaires/);
          } finally {
            await client.query("rollback");
          }
        }
      });

      it("une fois le compte renseigné, l'émission passe — BIC facultatif", async () => {
        await client.query("begin");
        try {
          await client.query(`update immeubles set ${comptes} where id = $1`, [immeubleId]);
          const { rows: a } = await client.query<{ id: string }>(
            `select id from appels where periode_id = $1 limit 1`,
            [periodeId],
          );
          const r = await emettre(a[0]!.id);
          expect(r.rowCount).toBe(1);
        } finally {
          await client.query("rollback");
        }
      });

      it("on peut toujours annuler un brouillon, et modifier un appel sans changer son statut", async () => {
        await client.query("begin");
        try {
          const { rows: a } = await client.query<{ id: string }>(
            `select id from appels where periode_id = $1 limit 2`,
            [periodeId],
          );
          const annule = await client.query(`update appels set statut = 'annule' where id = $1`, [a[0]!.id]);
          expect(annule.rowCount).toBe(1);
          const note = await client.query(`update appels set report_anterieur = 0 where id = $1`, [a[1]!.id]);
          expect(note.rowCount).toBe(1);
        } finally {
          await client.query("rollback");
        }
      });
    });
  });
});
