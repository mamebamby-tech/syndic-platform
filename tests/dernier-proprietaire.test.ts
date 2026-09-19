import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";
import { commeUtilisateur } from "./simuler-utilisateur";

// Une organisation garde toujours au moins un `proprietaire_org`
// (20260919100000_dernier_proprietaire_org.sql).
//
// Sans lui, plus personne ne peut administrer les membres : `membres_ecriture`
// réserve l'écriture à ce rôle. Tout se passe sur des cabinets fictifs ;
// chaque test s'exécute dans une transaction annulée, sauf le test de
// concurrence, qui crée et supprime son propre cabinet.

const MESSAGE = /au moins un proprietaire_org/;

describe("le dernier proprietaire_org d'une organisation est protégé", () => {
  let client: Client;
  let organisationId: string; // 2 propriétaires + 1 gestionnaire
  let autreOrganisationId: string;
  let soloOrganisationId: string; // 1 propriétaire seul
  let sansProprietaireOrganisationId: string; // n'en a jamais eu

  let proprio1: string;
  let proprio2: string;
  let gestionnaire: string;
  let solo: string;
  let gestionnaireOrphelin: string;
  const utilisateurs: string[] = [];
  const organisations: string[] = [];

  async function utilisateur(): Promise<string> {
    const r = await client.query<{ id: string }>(
      `insert into auth.users (id) values (gen_random_uuid()) returning id`,
    );
    utilisateurs.push(r.rows[0]!.id);
    return r.rows[0]!.id;
  }
  async function organisation(slug: string): Promise<string> {
    const r = await client.query<{ id: string }>(
      `insert into organisations (nom, slug) values ($1, $2) returning id`,
      [`Cabinet ${slug}`, slug],
    );
    organisations.push(r.rows[0]!.id);
    return r.rows[0]!.id;
  }
  const membre = (org: string, user: string, role: string) =>
    client.query(`insert into membres (organisation_id, user_id, role) values ($1, $2, $3)`, [
      org,
      user,
      role,
    ]);

  // Tente une requête dans un point de sauvegarde : l'erreur est attendue.
  async function refusee(sql: string, params: unknown[] = []): Promise<string | null> {
    await client.query("savepoint essai");
    try {
      await client.query(sql, params);
      await client.query("release savepoint essai");
      return null;
    } catch (e) {
      await client.query("rollback to savepoint essai");
      return e instanceof Error ? e.message : String(e);
    }
  }

  beforeAll(async () => {
    client = await connecter();
    organisationId = await organisation("test-dernier-proprio-a");
    autreOrganisationId = await organisation("test-dernier-proprio-b");
    soloOrganisationId = await organisation("test-dernier-proprio-solo");
    sansProprietaireOrganisationId = await organisation("test-dernier-proprio-sans");

    proprio1 = await utilisateur();
    proprio2 = await utilisateur();
    gestionnaire = await utilisateur();
    solo = await utilisateur();
    gestionnaireOrphelin = await utilisateur();

    await membre(organisationId, proprio1, "proprietaire_org");
    await membre(organisationId, proprio2, "proprietaire_org");
    await membre(organisationId, gestionnaire, "gestionnaire");
    await membre(soloOrganisationId, solo, "proprietaire_org");
    await membre(sansProprietaireOrganisationId, gestionnaireOrphelin, "gestionnaire");
  });

  afterAll(async () => {
    // Supprimer l'organisation est permis : plus rien à protéger.
    await client.query(`delete from organisations where id = any($1)`, [organisations]);
    await client.query(`delete from auth.users where id = any($1)`, [utilisateurs]);
    await client.end();
  });

  const dansTransaction = async (corps: () => Promise<void>) => {
    await client.query("begin");
    try {
      await corps();
    } finally {
      await client.query("rollback");
    }
  };

  describe("le seul propriétaire ne peut pas être retiré", () => {
    it("DELETE de sa ligne", async () => {
      await dansTransaction(async () => {
        const e = await refusee(`delete from membres where user_id = $1`, [solo]);
        expect(e).toMatch(MESSAGE);
      });
    });

    it("UPDATE de son rôle vers gestionnaire, lecteur", async () => {
      await dansTransaction(async () => {
        for (const role of ["gestionnaire", "lecteur"]) {
          const e = await refusee(`update membres set role = $2 where user_id = $1`, [solo, role]);
          expect(e, role).toMatch(MESSAGE);
        }
      });
    });

    it("UPDATE de organisation_id : la ligne ne peut pas quitter le cabinet", async () => {
      await dansTransaction(async () => {
        const e = await refusee(`update membres set organisation_id = $2 where user_id = $1`, [
          solo,
          autreOrganisationId,
        ]);
        expect(e).toMatch(MESSAGE);
      });
    });

    it("suppression de son compte (cascade depuis auth.users)", async () => {
      await dansTransaction(async () => {
        const e = await refusee(`delete from auth.users where id = $1`, [solo]);
        expect(e).toMatch(MESSAGE);
      });
    });

    it("la ligne est intacte après chaque refus", async () => {
      const { rows } = await client.query(
        `select role from membres where user_id = $1 and organisation_id = $2`,
        [solo, soloOrganisationId],
      );
      expect(rows).toEqual([{ role: "proprietaire_org" }]);
    });

    it("message d'erreur avec une piste de résolution", async () => {
      await dansTransaction(async () => {
        await client.query("savepoint s");
        await client.query(`delete from membres where user_id = $1`, [solo]).catch((e) => {
          expect(e.code).toBe("23001");
          expect(e.hint).toMatch(/Nommez un autre proprietaire_org/);
        });
      });
    });
  });

  describe("avec deux propriétaires, l'un peut partir, pas les deux", () => {
    it("rétrograder l'un est permis, puis rétrograder l'autre est refusé", async () => {
      await dansTransaction(async () => {
        expect(
          await refusee(`update membres set role = 'gestionnaire' where user_id = $1`, [proprio1]),
        ).toBeNull();
        expect(
          await refusee(`update membres set role = 'gestionnaire' where user_id = $1`, [proprio2]),
        ).toMatch(MESSAGE);
      });
    });

    it("supprimer l'un est permis, puis supprimer l'autre est refusé", async () => {
      await dansTransaction(async () => {
        expect(await refusee(`delete from membres where user_id = $1`, [proprio1])).toBeNull();
        expect(await refusee(`delete from membres where user_id = $1`, [proprio2])).toMatch(MESSAGE);
      });
    });

    it("supprimer le compte de l'un est permis, celui de l'autre est refusé", async () => {
      await dansTransaction(async () => {
        expect(await refusee(`delete from auth.users where id = $1`, [proprio1])).toBeNull();
        expect(await refusee(`delete from auth.users where id = $1`, [proprio2])).toMatch(MESSAGE);
      });
    });

    it("une seule requête qui les retire TOUS est refusée, même traités un par un", async () => {
      await dansTransaction(async () => {
        expect(
          await refusee(`delete from membres where organisation_id = $1`, [organisationId]),
        ).toMatch(MESSAGE);
        expect(
          await refusee(`update membres set role = 'lecteur' where organisation_id = $1`, [
            organisationId,
          ]),
        ).toMatch(MESSAGE);
        expect(
          await refusee(
            `delete from membres where organisation_id = $1 and role = 'proprietaire_org'`,
            [organisationId],
          ),
        ).toMatch(MESSAGE);
      });
    });

    it("promouvoir un remplaçant permet ensuite de partir", async () => {
      await dansTransaction(async () => {
        expect(
          await refusee(`update membres set role = 'proprietaire_org' where user_id = $1`, [gestionnaire]),
        ).toBeNull();
        expect(await refusee(`delete from membres where user_id = $1`, [proprio1])).toBeNull();
        expect(await refusee(`delete from membres where user_id = $1`, [proprio2])).toBeNull();
        // Le remplaçant est désormais seul : lui aussi est protégé.
        expect(await refusee(`delete from membres where user_id = $1`, [gestionnaire])).toMatch(MESSAGE);
      });
    });
  });

  describe("ce que le déclencheur ne gêne pas", () => {
    it("retirer ou rétrograder un gestionnaire", async () => {
      await dansTransaction(async () => {
        expect(
          await refusee(`update membres set role = 'lecteur' where user_id = $1`, [gestionnaire]),
        ).toBeNull();
        expect(await refusee(`delete from membres where user_id = $1`, [gestionnaire])).toBeNull();
      });
    });

    it("garder son rôle de propriétaire en modifiant autre chose", async () => {
      await dansTransaction(async () => {
        expect(
          await refusee(`update membres set role = 'proprietaire_org', langue = 'en' where user_id = $1`, [solo]),
        ).toBeNull();
        expect(await refusee(`update membres set langue = 'en' where user_id = $1`, [solo])).toBeNull();
      });
    });

    it("supprimer l'organisation entière, propriétaire seul compris", async () => {
      await dansTransaction(async () => {
        expect(await refusee(`delete from organisations where id = $1`, [soloOrganisationId])).toBeNull();
        const { rows } = await client.query(`select 1 from membres where organisation_id = $1`, [
          soloOrganisationId,
        ]);
        expect(rows).toHaveLength(0);
      });
    });

    it("une organisation qui n'a jamais eu de propriétaire reste libre de ses gestionnaires", async () => {
      await dansTransaction(async () => {
        expect(
          await refusee(`update membres set role = 'lecteur' where user_id = $1`, [gestionnaireOrphelin]),
        ).toBeNull();
        expect(await refusee(`delete from membres where user_id = $1`, [gestionnaireOrphelin])).toBeNull();
      });
    });

    it("on peut ajouter des propriétaires sans limite", async () => {
      await dansTransaction(async () => {
        const nouveau = await utilisateurEnTransaction();
        expect(await refusee(
          `insert into membres (organisation_id, user_id, role) values ($1, $2, 'proprietaire_org')`,
          [soloOrganisationId, nouveau],
        )).toBeNull();
      });
    });

    async function utilisateurEnTransaction(): Promise<string> {
      const r = await client.query<{ id: string }>(
        `insert into auth.users (id) values (gen_random_uuid()) returning id`,
      );
      return r.rows[0]!.id;
    }
  });

  describe("par les chemins réels de l'application (RLS)", () => {
    it("le seul propriétaire ne peut pas se rétrograder lui-même", async () => {
      await commeUtilisateur(client, solo, async () => {
        const e = await refusee(`update membres set role = 'gestionnaire' where user_id = $1`, [solo]);
        expect(e).toMatch(MESSAGE);
      });
    });

    it("ni se supprimer", async () => {
      await commeUtilisateur(client, solo, async () => {
        const e = await refusee(`delete from membres where user_id = $1`, [solo]);
        expect(e).toMatch(MESSAGE);
      });
    });

    it("un propriétaire d'une organisation à deux propriétaires peut se rétrograder", async () => {
      await commeUtilisateur(client, proprio1, async () => {
        const e = await refusee(`update membres set role = 'gestionnaire' where user_id = $1`, [proprio1]);
        expect(e).toBeNull();
      });
    });

    it("un gestionnaire ne peut de toute façon rien changer (RLS), et le déclencheur n'a rien à dire", async () => {
      await commeUtilisateur(client, gestionnaire, async () => {
        const r = await client.query(`update membres set role = 'lecteur' where user_id = $1`, [proprio1]);
        expect(r.rowCount).toBe(0);
      });
    });
  });

  describe("concurrence", () => {
    it("deux propriétaires qui se rétrogradent en même temps : l'un des deux échoue", async () => {
      const client2 = await connecter();
      const org = await organisation("test-dernier-proprio-concurrence");
      const a = await utilisateur();
      const b = await utilisateur();
      await membre(org, a, "proprietaire_org");
      await membre(org, b, "proprietaire_org");

      try {
        await client.query("begin");
        await client2.query("begin");

        // T1 rétrograde A : le déclencheur prend un verrou sur l'organisation.
        await client.query(`update membres set role = 'gestionnaire' where user_id = $1`, [a]);

        // T2 rétrograde B : sans le verrou, il verrait A encore propriétaire
        // (T1 n'a pas validé) et passerait. Il doit ATTENDRE T1.
        const t2 = client2
          .query(`update membres set role = 'gestionnaire' where user_id = $1`, [b])
          .then(() => "ok" as const, (e: Error) => e.message);
        const attente = await Promise.race([
          t2,
          new Promise<"attend">((resolve) => setTimeout(() => resolve("attend"), 500)),
        ]);
        expect(attente).toBe("attend");

        await client.query("commit");
        expect(await t2).toMatch(MESSAGE);
        await client2.query("rollback");

        const { rows } = await client.query(
          `select count(*)::int as n from membres where organisation_id = $1 and role = 'proprietaire_org'`,
          [org],
        );
        expect(rows[0].n).toBe(1);
      } finally {
        await client.query("rollback").catch(() => undefined);
        await client2.query("rollback").catch(() => undefined);
        await client2.end();
      }
    });
  });
});
