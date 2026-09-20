import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";
import { creerSessions, essayer } from "./aides";

// La note interne d'un propriétaire (proprietaires_notes, 20260920010000) n'est
// lisible que par le gestionnaire et le proprietaire_org. Elle était une colonne de
// `proprietaires`, donc lue par tout le personnel, lecteurs compris.
//
// Cabinets fictifs, validés en beforeAll puis supprimés ; chaque test dans une
// transaction annulée.

const NOTE = "Note interne : contact difficile, ne pas relancer par téléphone.";

describe("note interne d'un propriétaire — réservée aux habilités", () => {
  let client: Client;
  let organisationId: string;
  let autreOrganisationId: string;
  let immeubleId: string;
  let autreImmeubleId: string;
  let proprietaireId: string;
  let autreProprietaireId: string; // sans note
  let proprietaireAutreCabinetId: string;

  let gestionnaire: string;
  let proprietaireOrg: string;
  let lecteur: string;
  let gestionnaireAutreCabinet: string;
  let coproprietaire: string; // rattaché à proprietaireId

  const utilisateurs: string[] = [];
  const organisations: string[] = [];
  let sessions: ReturnType<typeof creerSessions>;

  const utilisateur = async (email: string) => {
    const r = await client.query<{ id: string }>(
      `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
      [email],
    );
    utilisateurs.push(r.rows[0]!.id);
    return r.rows[0]!.id;
  };
  const organisation = async (slug: string) => {
    const r = await client.query<{ id: string }>(
      `insert into organisations (nom, slug) values ($1, $2) returning id`,
      [`Cabinet ${slug}`, slug],
    );
    organisations.push(r.rows[0]!.id);
    return r.rows[0]!.id;
  };
  const immeuble = async (org: string, nom: string) =>
    (await client.query<{ id: string }>(`insert into immeubles (organisation_id, nom) values ($1, $2) returning id`, [org, nom])).rows[0]!.id;
  const proprietaire = async (im: string, nom: string) =>
    (await client.query<{ id: string }>(`insert into proprietaires (immeuble_id, nom) values ($1, $2) returning id`, [im, nom])).rows[0]!.id;

  beforeAll(async () => {
    client = await connecter();
    sessions = creerSessions(client);

    organisationId = await organisation("test-notes-a");
    autreOrganisationId = await organisation("test-notes-b");
    immeubleId = await immeuble(organisationId, "Immeuble notes A");
    autreImmeubleId = await immeuble(autreOrganisationId, "Immeuble notes B");
    proprietaireId = await proprietaire(immeubleId, "Propriétaire avec note");
    autreProprietaireId = await proprietaire(immeubleId, "Propriétaire sans note");
    proprietaireAutreCabinetId = await proprietaire(autreImmeubleId, "Propriétaire autre cabinet");

    gestionnaire = await utilisateur("gestionnaire.notes@example.com");
    proprietaireOrg = await utilisateur("proprio.notes@example.com");
    lecteur = await utilisateur("lecteur.notes@example.com");
    gestionnaireAutreCabinet = await utilisateur("autre.notes@example.com");
    coproprietaire = await utilisateur("copro.notes@example.com");
    for (const [org, user, role] of [
      [organisationId, gestionnaire, "gestionnaire"],
      [organisationId, proprietaireOrg, "proprietaire_org"],
      [organisationId, lecteur, "lecteur"],
      [autreOrganisationId, gestionnaireAutreCabinet, "gestionnaire"],
    ] as const) {
      await client.query(`insert into membres (organisation_id, user_id, role) values ($1, $2, $3)`, [org, user, role]);
    }
    await client.query(`insert into acces_personnes (user_id, proprietaire_id) values ($1, $2)`, [coproprietaire, proprietaireId]);

    await client.query(`insert into proprietaires_notes (proprietaire_id, immeuble_id, note) values ($1, $2, $3)`, [proprietaireId, immeubleId, NOTE]);
    await client.query(`insert into proprietaires_notes (proprietaire_id, immeuble_id, note) values ($1, $2, 'Note de l''autre cabinet')`, [proprietaireAutreCabinetId, autreImmeubleId]);
  });

  afterAll(async () => {
    await client.query(`delete from organisations where id = any($1)`, [organisations]);
    await client.query(`delete from auth.users where id = any($1)`, [utilisateurs]);
    await client.end();
  });

  const tx = (corps: () => Promise<void>) => sessions.dansTransaction(corps);
  const session = <T,>(user: string, corps: () => Promise<T>) => sessions.enSession(user, corps);
  const notesVisibles = async () => (await client.query<{ note: string }>(`select note from proprietaires_notes order by note`)).rows.map((r) => r.note);

  describe("la note n'est plus une colonne de proprietaires", () => {
    it("la colonne a disparu : aucun rôle ne peut plus la lire par la table des propriétaires", async () => {
      const { rows } = await client.query(
        `select 1 from information_schema.columns where table_schema = 'public' and table_name = 'proprietaires' and column_name = 'note'`,
      );
      expect(rows).toHaveLength(0);
    });

    it("un lecteur qui lit TOUTE la ligne d'un propriétaire n'y trouve aucune note", async () => {
      await tx(async () => {
        await session(lecteur, async () => {
          const { rows } = await client.query(`select * from proprietaires where id = $1`, [proprietaireId]);
          expect(rows).toHaveLength(1);
          expect(Object.keys(rows[0])).not.toContain("note");
          expect(JSON.stringify(rows[0])).not.toContain("contact difficile");
          const r = await essayer(client, `select note from proprietaires`);
          expect(r.erreur).toMatch(/column "note" does not exist/);
        });
      });
    });
  });

  describe("lecture : le gestionnaire et le proprietaire_org, pas le lecteur", () => {
    it("le gestionnaire lit les notes de son immeuble, et seulement elles", async () => {
      await tx(async () => {
        await session(gestionnaire, async () => {
          expect(await notesVisibles()).toEqual([NOTE]);
        });
      });
    });

    it("le proprietaire_org aussi", async () => {
      await tx(async () => {
        await session(proprietaireOrg, async () => {
          expect(await notesVisibles()).toEqual([NOTE]);
        });
      });
    });

    it("un lecteur du même cabinet ne lit AUCUNE note, alors qu'il lit le propriétaire", async () => {
      await tx(async () => {
        await session(lecteur, async () => {
          expect(await notesVisibles()).toEqual([]);
          const p = await client.query(`select id from proprietaires where id = $1`, [proprietaireId]);
          expect(p.rowCount).toBe(1);
          // ni en filtrant sur la clé, ni par jointure
          expect((await client.query(`select note from proprietaires_notes where proprietaire_id = $1`, [proprietaireId])).rowCount).toBe(0);
          expect(
            (await client.query(`select n.note from proprietaires p join proprietaires_notes n on n.proprietaire_id = p.id`)).rowCount,
          ).toBe(0);
        });
      });
    });

    it("un gestionnaire d'un autre cabinet ne lit pas les notes de celui-ci (et lit les siennes)", async () => {
      await tx(async () => {
        await session(gestionnaireAutreCabinet, async () => {
          expect(await notesVisibles()).toEqual(["Note de l'autre cabinet"]);
        });
      });
    });

    it("un copropriétaire ne lit aucune note, pas même celle qui le concerne", async () => {
      await tx(async () => {
        await session(coproprietaire, async () => {
          expect(await notesVisibles()).toEqual([]);
        });
      });
    });

    it("sans session, rien", async () => {
      await tx(async () => {
        await client.query("set local role authenticated");
        expect(await notesVisibles()).toEqual([]);
        await client.query("reset role");
      });
    });
  });

  describe("écriture : réservée aux habilités", () => {
    it("le lecteur ne peut ni ajouter, ni modifier, ni supprimer une note", async () => {
      await tx(async () => {
        await session(lecteur, async () => {
          const ajout = await essayer(client, `insert into proprietaires_notes (proprietaire_id, immeuble_id, note) values ($1, $2, 'intrus')`, [autreProprietaireId, immeubleId]);
          expect(ajout.erreur).toMatch(/row-level security/);
          expect((await essayer(client, `update proprietaires_notes set note = 'modifiée'`)).lignes).toBe(0);
          expect((await essayer(client, `delete from proprietaires_notes`)).lignes).toBe(0);
        });
        // Rien n'a changé (lu en propriétaire de la base, sur les seuls immeubles de test).
        const { rows } = await client.query<{ note: string }>(
          `select note from proprietaires_notes where immeuble_id = any($1) order by note`,
          [[immeubleId, autreImmeubleId]],
        );
        expect(rows.map((r) => r.note)).toEqual([NOTE, "Note de l'autre cabinet"].sort());
      });
    });

    it("le gestionnaire ajoute, modifie et supprime", async () => {
      await tx(async () => {
        await session(gestionnaire, async () => {
          expect((await essayer(client, `insert into proprietaires_notes (proprietaire_id, immeuble_id, note) values ($1, $2, 'nouvelle')`, [autreProprietaireId, immeubleId])).erreur).toBeNull();
          expect((await essayer(client, `update proprietaires_notes set note = 'corrigée' where proprietaire_id = $1`, [autreProprietaireId])).lignes).toBe(1);
          expect((await essayer(client, `delete from proprietaires_notes where proprietaire_id = $1`, [autreProprietaireId])).lignes).toBe(1);
        });
      });
    });

    it("le proprietaire_org aussi", async () => {
      await tx(async () => {
        await session(proprietaireOrg, async () => {
          expect((await essayer(client, `update proprietaires_notes set note = 'corrigée' where proprietaire_id = $1`, [proprietaireId])).lignes).toBe(1);
        });
      });
    });

    it("le gestionnaire d'un autre cabinet ne peut pas écrire chez celui-ci", async () => {
      await tx(async () => {
        await session(gestionnaireAutreCabinet, async () => {
          const ajout = await essayer(client, `insert into proprietaires_notes (proprietaire_id, immeuble_id, note) values ($1, $2, 'intrus')`, [autreProprietaireId, immeubleId]);
          expect(ajout.erreur).toMatch(/row-level security/);
          expect((await essayer(client, `update proprietaires_notes set note = 'x' where proprietaire_id = $1`, [proprietaireId])).lignes).toBe(0);
          expect((await essayer(client, `delete from proprietaires_notes where proprietaire_id = $1`, [proprietaireId])).lignes).toBe(0);
        });
      });
    });
  });

  describe("cohérence", () => {
    it("une note ne peut pas viser un immeuble qui n'est pas celui de son propriétaire (clé composite)", async () => {
      await tx(async () => {
        const r = await essayer(client, `insert into proprietaires_notes (proprietaire_id, immeuble_id, note) values ($1, $2, 'incohérente')`, [autreProprietaireId, autreImmeubleId]);
        expect(r.erreur).toMatch(/foreign key/);
      });
    });

    it("une seule note par propriétaire, et jamais vide", async () => {
      await tx(async () => {
        expect(
          (await essayer(client, `insert into proprietaires_notes (proprietaire_id, immeuble_id, note) values ($1, $2, 'seconde')`, [proprietaireId, immeubleId])).erreur,
        ).toMatch(/duplicate key/);
        expect(
          (await essayer(client, `insert into proprietaires_notes (proprietaire_id, immeuble_id, note) values ($1, $2, '   ')`, [autreProprietaireId, immeubleId])).erreur,
        ).toMatch(/check constraint/);
      });
    });

    it("supprimer le propriétaire supprime sa note", async () => {
      await tx(async () => {
        await client.query(`delete from proprietaires where id = $1`, [proprietaireId]);
        expect((await client.query(`select 1 from proprietaires_notes where proprietaire_id = $1`, [proprietaireId])).rowCount).toBe(0);
      });
    });
  });
});
