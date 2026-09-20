import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";
import { essayer } from "./aides";

// Cohérence entre le budget et les appels (20260919130000) — EN BASE, pas
// seulement dans l'écran : c'est la base qui doit refuser d'émettre un brouillon
// obsolète, et de modifier un budget dont des appels sont émis.
//
// Une seule transaction, annulée à la fin (le fichier modifie les coordonnées
// bancaires de l'immeuble de dev, qui sont des réglages manuels). Les échecs
// attendus passent par des points de sauvegarde.

describe("budget et appels — obsolescence, émission refusée, verrou", () => {
  let client: Client;
  let immeubleId: string;
  let organisationId: string;
  let periodeId: string;
  let exerciceId: string;
  let posteIds: string[];
  let autrePosteId: string;
  let gestionnaire: string;
  let lecteur: string;

  const brouillons = async () =>
    (await client.query(`select * from appels where periode_id = $1 and statut = 'brouillon' order by numero`, [periodeId])).rows;
  const appel = async (id: string) => (await client.query(`select * from appels where id = $1`, [id])).rows[0];
  const emettre = (id: string) => client.query(`update appels set statut = 'emis' where id = $1`, [id]);
  const generer = () => client.query(`select app.generer_appels($1) as n`, [periodeId]);
  const budget = async () =>
    (await client.query(`select poste_charge_id, montant, fournisseur, note from budget_lignes where periode_id = $1 order by poste_charge_id`, [periodeId])).rows;

  const sauvegarde = async (corps: () => Promise<void>) => {
    await client.query("savepoint t");
    try {
      await corps();
    } finally {
      await client.query("rollback to savepoint t");
    }
  };
  const enSession = async <T,>(utilisateur: string, corps: () => Promise<T>): Promise<T> => {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: utilisateur })]);
    try {
      return await corps();
    } finally {
      await client.query("reset role");
      // Les claims restent posés jusqu'à la fin de la transaction : les effacer,
      // sinon l'appel « propriétaire » suivant se ferait encore sous cette identité.
      await client.query("select set_config('request.jwt.claims', '{}', true)");
    }
  };

  beforeAll(async () => {
    client = await connecter();
    await client.query("begin");

    const im = await client.query<{ id: string; organisation_id: string }>(
      `select id, organisation_id from immeubles where nom = 'Mamelles Tower'`,
    );
    immeubleId = im.rows[0]!.id;
    organisationId = im.rows[0]!.organisation_id;

    const users: string[] = [];
    for (const [email, role] of [
      ["budget.gestionnaire@example.com", "gestionnaire"],
      ["budget.lecteur@example.com", "lecteur"],
    ] as const) {
      const u = await client.query<{ id: string }>(
        `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
        [email],
      );
      await client.query(`insert into membres (organisation_id, user_id, role) values ($1, $2, $3)`, [
        organisationId,
        u.rows[0]!.id,
        role,
      ]);
      users.push(u.rows[0]!.id);
    }
    [gestionnaire, lecteur] = users as [string, string];

    const postes = await client.query<{ id: string }>(
      `select pc.id from postes_charges pc join cles_repartition cr on cr.id = pc.cle_repartition_id
       where pc.immeuble_id = $1 and cr.code = 'tantiemes' and pc.categorie = 'general' order by pc.ordre`,
      [immeubleId],
    );
    posteIds = postes.rows.slice(0, 3).map((p) => p.id);
    autrePosteId = postes.rows[3]!.id;

    const exercice = await client.query<{ id: string }>(
      `insert into exercices (immeuble_id, libelle, date_debut, date_fin)
       values ($1, 'Exercice test budget-appels', '2030-01-01', '2030-12-31') returning id`,
      [immeubleId],
    );
    exerciceId = exercice.rows[0]!.id;
    const periode = await client.query<{ id: string }>(
      `insert into periodes (exercice_id, libelle, date_debut, date_fin, date_echeance)
       values ($1, 'Période test budget-appels', '2030-01-01', '2030-03-31', '2030-01-01') returning id`,
      [exerciceId],
    );
    periodeId = periode.rows[0]!.id;
    for (const [i, id] of posteIds.entries()) {
      await client.query(`insert into budget_lignes (periode_id, poste_charge_id, montant, fournisseur) values ($1, $2, $3, 'Fournisseur')`, [
        periodeId,
        id,
        [450000, 275500.5, 89999.99][i],
      ]);
    }
    await client.query(
      `update immeubles set compte_titulaire = 'Syndicat test', compte_banque = 'Banque test',
         compte_numero = 'SN00 TEST 0000' where id = $1`,
      [immeubleId],
    );
    await generer();
  });

  afterAll(async () => {
    await client.query("rollback");
    await client.end();
  });

  describe("1. modifier le budget après la génération rend les brouillons obsolètes", () => {
    it("juste après la génération, aucun brouillon n'est obsolète", async () => {
      const b = await brouillons();
      expect(b.length).toBe(19);
      for (const a of b) expect(a.obsolete).toBe(false);
    });

    it("un montant modifié : tous les brouillons de la période deviennent obsolètes", async () => {
      await sauvegarde(async () => {
        await client.query(`update budget_lignes set montant = montant + 1 where periode_id = $1 and poste_charge_id = $2`, [periodeId, posteIds[0]]);
        for (const a of await brouillons()) expect(a.obsolete).toBe(true);
      });
    });

    it("une ligne ajoutée avec un montant : obsolètes", async () => {
      await sauvegarde(async () => {
        await client.query(`insert into budget_lignes (periode_id, poste_charge_id, montant) values ($1, $2, 1000)`, [periodeId, autrePosteId]);
        for (const a of await brouillons()) expect(a.obsolete).toBe(true);
      });
    });

    it("une ligne supprimée qui avait un montant : obsolètes", async () => {
      await sauvegarde(async () => {
        await client.query(`delete from budget_lignes where periode_id = $1 and poste_charge_id = $2`, [periodeId, posteIds[1]]);
        for (const a of await brouillons()) expect(a.obsolete).toBe(true);
      });
    });

    it("la clé de répartition d'un poste modifiée : obsolètes", async () => {
      await sauvegarde(async () => {
        const autre = await client.query<{ id: string }>(
          `select id from cles_repartition where immeuble_id = $1
           and id <> (select cle_repartition_id from postes_charges where id = $2) limit 1`,
          [immeubleId, posteIds[0]],
        );
        await client.query(`update postes_charges set cle_repartition_id = $2 where id = $1`, [posteIds[0], autre.rows[0]!.id]);
        for (const a of await brouillons()) expect(a.obsolete).toBe(true);
      });
    });

    describe("ce qui ne change pas les montants n'obsolète rien", () => {
      it("enregistrer les mêmes valeurs (l'écran renvoie tout à chaque sauvegarde)", async () => {
        await sauvegarde(async () => {
          for (const l of await budget()) {
            await client.query(
              `insert into budget_lignes (periode_id, poste_charge_id, montant, fournisseur, note) values ($1, $2, $3, $4, $5)
               on conflict (periode_id, poste_charge_id) do update set montant = excluded.montant, fournisseur = excluded.fournisseur, note = excluded.note`,
              [periodeId, l.poste_charge_id, l.montant, l.fournisseur, l.note],
            );
          }
          for (const a of await brouillons()) expect(a.obsolete).toBe(false);
        });
      });

      it("changer le fournisseur ou la note d'un poste", async () => {
        await sauvegarde(async () => {
          await client.query(`update budget_lignes set fournisseur = 'Autre', note = 'nouvelle note' where periode_id = $1`, [periodeId]);
          for (const a of await brouillons()) expect(a.obsolete).toBe(false);
        });
      });

      it("ajouter ou supprimer une ligne à montant zéro", async () => {
        await sauvegarde(async () => {
          await client.query(`insert into budget_lignes (periode_id, poste_charge_id, montant) values ($1, $2, 0)`, [periodeId, autrePosteId]);
          await client.query(`delete from budget_lignes where periode_id = $1 and poste_charge_id = $2`, [periodeId, autrePosteId]);
          for (const a of await brouillons()) expect(a.obsolete).toBe(false);
        });
      });

      it("changer la clé d'un poste en la remplaçant par la même", async () => {
        await sauvegarde(async () => {
          await client.query(`update postes_charges set cle_repartition_id = cle_repartition_id where id = $1`, [posteIds[0]]);
          for (const a of await brouillons()) expect(a.obsolete).toBe(false);
        });
      });
    });

    it("régénérer efface l'obsolescence : les brouillons sont recréés, à jour", async () => {
      await sauvegarde(async () => {
        await client.query(`update budget_lignes set montant = montant + 1 where periode_id = $1 and poste_charge_id = $2`, [periodeId, posteIds[0]]);
        expect((await brouillons())[0].obsolete).toBe(true);
        await generer();
        const b = await brouillons();
        expect(b.length).toBe(19);
        for (const a of b) expect(a.obsolete).toBe(false);
      });
    });
  });

  describe("2. la base refuse d'émettre un brouillon obsolète", () => {
    const rendreObsolete = () =>
      client.query(`update budget_lignes set montant = montant + 1 where periode_id = $1 and poste_charge_id = $2`, [periodeId, posteIds[0]]);

    it("l'émission d'un brouillon obsolète est refusée, sans rien figer", async () => {
      await sauvegarde(async () => {
        await rendreObsolete();
        const [a] = await brouillons();
        const r = await essayer(client, `update appels set statut = 'emis' where id = $1`, [a.id]);
        expect(r.erreur).toMatch(/obsolète/);
        const apres = await appel(a.id);
        expect(apres.statut).toBe("brouillon");
        expect(apres.instantane).toBeNull();
        expect(apres.date_emission).toBeNull();
      });
    });

    it("refusée aussi pour partiel et soldé, et pour tous les brouillons de la période", async () => {
      await sauvegarde(async () => {
        await rendreObsolete();
        for (const statut of ["emis", "partiel", "solde"]) {
          for (const a of (await brouillons()).slice(0, 3)) {
            const r = await essayer(client, `update appels set statut = $2 where id = $1`, [a.id, statut]);
            expect(r.erreur, statut).toMatch(/obsolète/);
          }
        }
      });
    });

    it("refusée quel que soit le rôle : gestionnaire comme propriétaire de la base", async () => {
      await sauvegarde(async () => {
        await rendreObsolete();
        const [a] = await brouillons();
        await enSession(gestionnaire, async () => {
          const r = await essayer(client, `update appels set statut = 'emis' where id = $1`, [a.id]);
          expect(r.erreur).toMatch(/obsolète/);
        });
      });
    });

    it("après régénération, l'émission passe", async () => {
      await sauvegarde(async () => {
        await rendreObsolete();
        await generer();
        const [a] = await brouillons();
        expect((await essayer(client, `update appels set statut = 'emis' where id = $1`, [a.id])).erreur).toBeNull();
        expect((await appel(a.id)).instantane).not.toBeNull();
      });
    });

    it("un brouillon à jour s'émet normalement (la règle ne bloque pas tout)", async () => {
      await sauvegarde(async () => {
        const [a] = await brouillons();
        expect((await essayer(client, `update appels set statut = 'emis' where id = $1`, [a.id])).erreur).toBeNull();
      });
    });

    it("le drapeau ne se remet pas à faux à la main : droit de colonne refusé aux utilisateurs", async () => {
      await sauvegarde(async () => {
        await rendreObsolete();
        const [a] = await brouillons();
        for (const utilisateur of [gestionnaire, lecteur]) {
          await enSession(utilisateur, async () => {
            const r = await essayer(client, `update appels set obsolete = false where id = $1`, [a.id]);
            expect(r.erreur).toMatch(/permission denied/);
          });
        }
        expect((await appel(a.id)).obsolete).toBe(true);
        // ...et l'émission reste refusée.
        expect((await essayer(client, `update appels set statut = 'emis' where id = $1`, [a.id])).erreur).toMatch(/obsolète/);
      });
    });

    it("un utilisateur ne modifie ni les montants, ni la référence, ni n'insère ni ne supprime un appel", async () => {
      await sauvegarde(async () => {
        const [a] = await brouillons();
        await enSession(gestionnaire, async () => {
          for (const sql of [
            `update appels set montant_total = 1 where id = $1`,
            `update appels set reference = 'X' where id = $1`,
            `update appels set date_echeance = '2031-01-01' where id = $1`,
            `update appels set instantane = '{}'::jsonb where id = $1`,
            `update appels set proprietaire_id = proprietaire_id, periode_id = periode_id where id = $1`,
            `delete from appels where id = $1`,
          ]) {
            expect((await essayer(client, sql, [a.id])).erreur, sql).toMatch(/permission denied/);
          }
          expect(
            (await essayer(client, `insert into appels (periode_id, proprietaire_id, reference, date_echeance) values ($1, $2, 'X', '2030-01-01')`, [a.periode_id, a.proprietaire_id])).erreur,
          ).toMatch(/permission denied/);
          // Ce qu'un utilisateur PEUT faire : le statut (à jour) et le report.
          expect((await essayer(client, `update appels set report_anterieur = 0 where id = $1`, [a.id])).erreur).toBeNull();
          expect((await essayer(client, `update appels set statut = 'emis' where id = $1`, [a.id])).erreur).toBeNull();
        });
      });
    });

    it("un lecteur ne peut pas émettre, obsolète ou non", async () => {
      await sauvegarde(async () => {
        const [a] = await brouillons();
        await enSession(lecteur, async () => {
          // Refusé par la sécurité par ligne (0 ligne modifiée) ; le déclencheur
          // d'émission le refuserait aussi, en seconde ligne.
          const r = await essayer(client, `update appels set statut = 'emis' where id = $1`, [a.id]);
          expect(r.erreur !== null || r.lignes === 0).toBe(true);
        });
        expect((await appel(a.id)).statut).toBe("brouillon");
      });
    });
  });

  describe("3. le budget d'une période avec des appels émis est verrouillé", () => {
    const VERROU = /budget de cette période est verrouillé/;

    it("tant qu'aucun appel n'est émis, le budget se modifie", async () => {
      await sauvegarde(async () => {
        expect(
          (await essayer(client, `update budget_lignes set montant = montant + 1 where periode_id = $1 and poste_charge_id = $2`, [periodeId, posteIds[0]])).erreur,
        ).toBeNull();
      });
    });

    it("après une émission : ajouter, modifier ou supprimer une ligne est refusé", async () => {
      await sauvegarde(async () => {
        await emettre((await brouillons())[0].id);
        const avant = await budget();
        const refus = [
          await essayer(client, `update budget_lignes set montant = montant + 1 where periode_id = $1 and poste_charge_id = $2`, [periodeId, posteIds[0]]),
          await essayer(client, `insert into budget_lignes (periode_id, poste_charge_id, montant) values ($1, $2, 1000)`, [periodeId, autrePosteId]),
          await essayer(client, `delete from budget_lignes where periode_id = $1 and poste_charge_id = $2`, [periodeId, posteIds[1]]),
        ];
        for (const r of refus) expect(r.erreur).toMatch(VERROU);
        expect(await budget()).toEqual(avant);
      });
    });

    it("même changer un fournisseur, une note, ou remettre les mêmes valeurs (comme le fait l'écran) est refusé", async () => {
      await sauvegarde(async () => {
        await emettre((await brouillons())[0].id);
        const l = (await budget())[0];
        expect((await essayer(client, `update budget_lignes set fournisseur = 'Autre' where periode_id = $1`, [periodeId])).erreur).toMatch(VERROU);
        expect(
          (
            await essayer(
              client,
              `insert into budget_lignes (periode_id, poste_charge_id, montant) values ($1, $2, $3)
               on conflict (periode_id, poste_charge_id) do update set montant = excluded.montant`,
              [periodeId, l.poste_charge_id, l.montant],
            )
          ).erreur,
        ).toMatch(VERROU);
      });
    });

    it("refusé quel que soit le rôle : un gestionnaire ne le contourne pas", async () => {
      await sauvegarde(async () => {
        await emettre((await brouillons())[0].id);
        await enSession(gestionnaire, async () => {
          const r = await essayer(client, `update budget_lignes set montant = montant + 1 where periode_id = $1`, [periodeId]);
          expect(r.erreur ?? "refusé").toMatch(/verrouillé|refusé/);
          expect(r.lignes).toBe(0);
        });
      });
    });

    it("le verrou est propre à la période : une autre période reste modifiable", async () => {
      await sauvegarde(async () => {
        await emettre((await brouillons())[0].id);
        const autre = await client.query<{ id: string }>(
          `insert into periodes (exercice_id, libelle, date_debut, date_fin, date_echeance)
           values ($1, 'Autre période', '2030-04-01', '2030-06-30', '2030-04-01') returning id`,
          [exerciceId],
        );
        const r = await essayer(client, `insert into budget_lignes (periode_id, poste_charge_id, montant) values ($1, $2, 500)`, [autre.rows[0]!.id, posteIds[0]]);
        expect(r.erreur).toBeNull();
      });
    });

    it("on ne déplace pas une ligne vers ou depuis une période verrouillée", async () => {
      await sauvegarde(async () => {
        await emettre((await brouillons())[0].id);
        const autre = await client.query<{ id: string }>(
          `insert into periodes (exercice_id, libelle, date_debut, date_fin, date_echeance)
           values ($1, 'Autre période', '2030-04-01', '2030-06-30', '2030-04-01') returning id`,
          [exerciceId],
        );
        const r = await essayer(client, `update budget_lignes set periode_id = $2 where periode_id = $1 and poste_charge_id = $3`, [periodeId, autre.rows[0]!.id, posteIds[0]]);
        expect(r.erreur).toMatch(VERROU);
      });
    });

    it("annuler l'unique appel émis rouvre le budget ; tant qu'il en reste un, il est verrouillé", async () => {
      await sauvegarde(async () => {
        const [a, b] = await brouillons();
        await emettre(a.id);
        await emettre(b.id);
        await client.query(`update appels set statut = 'annule' where id = $1`, [a.id]);
        expect(
          (await essayer(client, `update budget_lignes set montant = montant + 1 where periode_id = $1 and poste_charge_id = $2`, [periodeId, posteIds[0]])).erreur,
        ).toMatch(VERROU);
        await client.query(`update appels set statut = 'annule' where id = $1`, [b.id]);
        expect(
          (await essayer(client, `update budget_lignes set montant = montant + 1 where periode_id = $1 and poste_charge_id = $2`, [periodeId, posteIds[0]])).erreur,
        ).toBeNull();
      });
    });

    it("un brouillon annulé (jamais émis) ne verrouille rien", async () => {
      await sauvegarde(async () => {
        await client.query(`update appels set statut = 'annule' where id = $1`, [(await brouillons())[0].id]);
        expect(
          (await essayer(client, `update budget_lignes set montant = montant + 1 where periode_id = $1 and poste_charge_id = $2`, [periodeId, posteIds[0]])).erreur,
        ).toBeNull();
      });
    });

    it("le budget verrouillé, on peut régénérer les brouillons restants : l'émis est intact", async () => {
      await sauvegarde(async () => {
        const emisId = (await brouillons())[0].id;
        await emettre(emisId);
        const avant = await appel(emisId);
        await generer();
        expect(await appel(emisId)).toEqual(avant);
        const restants = await brouillons();
        expect(restants.length).toBe(18);
        for (const a of restants) expect(a.obsolete).toBe(false);
      });
    });

    it("le verrou ne gêne pas la suppression de la période, de l'exercice ou du cabinet (cascade)", async () => {
      await sauvegarde(async () => {
        await emettre((await brouillons())[0].id);
        const r = await essayer(client, `delete from exercices where id = $1`, [exerciceId]);
        expect(r.erreur).toBeNull();
        const { rows } = await client.query(`select count(*)::int n from budget_lignes where periode_id = $1`, [periodeId]);
        expect(rows[0].n).toBe(0);
      });
    });
  });
});
