import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";
import { commeUtilisateur } from "./simuler-utilisateur";
import { LANGUES } from "@/lib/i18n/config";

// Changer sa langue — et ne rien pouvoir faire d'autre.
//
// La langue est stockée sur `membres` (personnel) et `proprietaires`
// (copropriétaire). `membres_ecriture` réserve l'écriture au rôle
// `proprietaire_org` : la seule voie pour une personne ordinaire est
// public.changer_langue(), dont on vérifie ici qu'elle change la langue et
// n'ouvre aucune porte vers `role`.
//
// Tout se passe sur un cabinet fictif, sans lien avec Mamelles Tower ni
// donnée personnelle réelle. Les lignes semées sont supprimées en fin de
// fichier ; chaque test s'exécute dans une transaction annulée.

interface Resultat {
  erreur: string | null;
  lignes: number;
}

// Tente une requête sans faire échouer la transaction de test : une erreur
// (with check, droit refusé) est attendue et se mesure, pas se subit.
async function essayer(client: Client, sql: string, params: unknown[] = []): Promise<Resultat> {
  await client.query("savepoint essai");
  try {
    const r = await client.query(sql, params);
    await client.query("release savepoint essai");
    return { erreur: null, lignes: r.rowCount ?? 0 };
  } catch (e) {
    await client.query("rollback to savepoint essai");
    return { erreur: e instanceof Error ? e.message : String(e), lignes: 0 };
  }
}

// Lit en tant que propriétaire de la base (hors RLS) au milieu d'une
// transaction simulée, pour constater ce qui a réellement été écrit.
async function enProprietaire<T>(client: Client, lecture: () => Promise<T>): Promise<T> {
  await client.query("reset role");
  try {
    return await lecture();
  } finally {
    await client.query("set local role authenticated");
  }
}

describe("changer sa langue — public.changer_langue / public.ma_langue", () => {
  let client: Client;
  let organisationId: string;
  let immeubleId: string;

  let gestionnaire: string;
  let lecteur: string;
  let proprietaireOrg: string;
  let coproprietaire: string;
  let sansRattachement: string;

  let proprietaireA: string; // rattaché au compte `coproprietaire`
  let proprietaireB: string; // sans rapport
  let groupe: string; // ayant droit consolidé de A

  const utilisateurs: string[] = [];

  async function nouvelUtilisateur(): Promise<string> {
    const r = await client.query<{ id: string }>(
      `insert into auth.users (id) values (gen_random_uuid()) returning id`,
    );
    utilisateurs.push(r.rows[0]!.id);
    return r.rows[0]!.id;
  }

  async function nouveauProprietaire(nom: string, groupeId: string | null, estGroupe = false) {
    const r = await client.query<{ id: string }>(
      `insert into proprietaires (immeuble_id, nom, groupe_id, est_groupe)
       values ($1, $2, $3, $4) returning id`,
      [immeubleId, nom, groupeId, estGroupe],
    );
    return r.rows[0]!.id;
  }

  beforeAll(async () => {
    client = await connecter();

    const org = await client.query<{ id: string }>(
      `insert into organisations (nom, slug) values ('Cabinet Test Langue', 'test-langue')
       returning id`,
    );
    organisationId = org.rows[0]!.id;
    const immeuble = await client.query<{ id: string }>(
      `insert into immeubles (organisation_id, nom) values ($1, 'Immeuble Test Langue')
       returning id`,
      [organisationId],
    );
    immeubleId = immeuble.rows[0]!.id;

    gestionnaire = await nouvelUtilisateur();
    lecteur = await nouvelUtilisateur();
    proprietaireOrg = await nouvelUtilisateur();
    coproprietaire = await nouvelUtilisateur();
    sansRattachement = await nouvelUtilisateur();

    for (const [user, role] of [
      [gestionnaire, "gestionnaire"],
      [lecteur, "lecteur"],
      [proprietaireOrg, "proprietaire_org"],
    ] as const) {
      await client.query(
        `insert into membres (organisation_id, user_id, role) values ($1, $2, $3)`,
        [organisationId, user, role],
      );
    }

    groupe = await nouveauProprietaire("Groupe Test Langue", null, true);
    proprietaireA = await nouveauProprietaire("Entité A Test Langue", groupe);
    proprietaireB = await nouveauProprietaire("Entité B Test Langue", null);
    await client.query(`insert into acces_personnes (user_id, proprietaire_id) values ($1, $2)`, [
      coproprietaire,
      proprietaireA,
    ]);
  });

  afterAll(async () => {
    // Le cabinet emporte membres, immeuble et propriétaires en cascade ;
    // acces_personnes tombe avec les comptes.
    await client.query(`delete from organisations where id = $1`, [organisationId]);
    await client.query(`delete from auth.users where id = any($1)`, [utilisateurs]);
    await client.end();
  });

  const roleDe = async (user: string) =>
    (await client.query<{ role: string }>(`select role from membres where user_id = $1`, [user]))
      .rows[0]?.role;
  const langueMembre = async (user: string) =>
    (await client.query<{ langue: string }>(`select langue from membres where user_id = $1`, [user]))
      .rows[0]?.langue;
  const langueProprietaire = async (id: string) =>
    (await client.query<{ langue: string }>(`select langue from proprietaires where id = $1`, [id]))
      .rows[0]?.langue;

  describe("le personnel change sa langue", () => {
    it("un gestionnaire passe à en : sa langue change, son rôle non", async () => {
      await commeUtilisateur(client, gestionnaire, async () => {
        expect((await client.query(`select public.ma_langue() as l`)).rows[0].l).toBe("fr");
        await client.query(`select public.changer_langue('en')`);
        expect((await client.query(`select public.ma_langue() as l`)).rows[0].l).toBe("en");

        await enProprietaire(client, async () => {
          expect(await langueMembre(gestionnaire)).toBe("en");
          expect(await roleDe(gestionnaire)).toBe("gestionnaire");
        });
      });
    });

    it("ne touche jamais la ligne d'un autre membre du même cabinet", async () => {
      await commeUtilisateur(client, gestionnaire, async () => {
        await client.query(`select public.changer_langue('en')`);
        await enProprietaire(client, async () => {
          expect(await langueMembre(lecteur)).toBe("fr");
          expect(await langueMembre(proprietaireOrg)).toBe("fr");
          expect(await roleDe(lecteur)).toBe("lecteur");
          expect(await roleDe(proprietaireOrg)).toBe("proprietaire_org");
        });
      });
    });

    it("un lecteur peut aussi changer sa langue, sans changer de rôle", async () => {
      await commeUtilisateur(client, lecteur, async () => {
        await client.query(`select public.changer_langue('en')`);
        await enProprietaire(client, async () => {
          expect(await langueMembre(lecteur)).toBe("en");
          expect(await roleDe(lecteur)).toBe("lecteur");
        });
      });
    });

    it("un proprietaire_org change sa langue sans que la fonction touche à son rôle", async () => {
      await commeUtilisateur(client, proprietaireOrg, async () => {
        await client.query(`select public.changer_langue('en')`);
        await enProprietaire(client, async () => {
          expect(await langueMembre(proprietaireOrg)).toBe("en");
          expect(await roleDe(proprietaireOrg)).toBe("proprietaire_org");
        });
      });
    });
  });

  describe("le copropriétaire change sa langue", () => {
    it("lit sa langue malgré l'absence de politique de lecture sur proprietaires", async () => {
      await commeUtilisateur(client, coproprietaire, async () => {
        // Preuve du besoin : la ligne proprietaires n'est pas lisible directement.
        const direct = await client.query(`select langue from proprietaires where id = $1`, [
          proprietaireA,
        ]);
        expect(direct.rowCount).toBe(0);
        expect((await client.query(`select public.ma_langue() as l`)).rows[0].l).toBe("fr");
      });
    });

    it("change la langue de SA ligne, pas celle du groupe ni d'une autre entité", async () => {
      await commeUtilisateur(client, coproprietaire, async () => {
        await client.query(`select public.changer_langue('en')`);
        expect((await client.query(`select public.ma_langue() as l`)).rows[0].l).toBe("en");

        await enProprietaire(client, async () => {
          expect(await langueProprietaire(proprietaireA)).toBe("en");
          expect(await langueProprietaire(groupe)).toBe("fr");
          expect(await langueProprietaire(proprietaireB)).toBe("fr");
        });
      });
    });
  });

  describe("valeurs refusées, sans aucun effet", () => {
    const refusees: [string, string | null][] = [
      ["langue inconnue", "xx"],
      ["casse différente", "EN"],
      ["code régional", "en-GB"],
      ["chaîne vide", ""],
      ["NULL", null],
      ["nom de langue", "english"],
      ["tentative d'injection dans la valeur", "en', role = 'proprietaire_org' --"],
      ["tentative d'injection multi-instruction", "en'; update membres set role = 'proprietaire_org'; --"],
    ];

    for (const [libelle, valeur] of refusees) {
      it(`refuse ${libelle} : langue et rôle inchangés`, async () => {
        await commeUtilisateur(client, gestionnaire, async () => {
          const r = await essayer(client, `select public.changer_langue($1)`, [valeur]);
          expect(r.erreur).not.toBeNull();

          await enProprietaire(client, async () => {
            expect(await langueMembre(gestionnaire)).toBe("fr");
            expect(await roleDe(gestionnaire)).toBe("gestionnaire");
          });
        });
      });
    }

    it("refuse un appel sans session", async () => {
      await commeUtilisateur(client, null, async () => {
        const r = await essayer(client, `select public.changer_langue('en')`);
        expect(r.erreur).toMatch(/Non authentifié/);
      });
    });

    it("refuse un compte sans aucune ligne de préférence, au lieu de faire semblant", async () => {
      await commeUtilisateur(client, sansRattachement, async () => {
        const r = await essayer(client, `select public.changer_langue('en')`);
        expect(r.erreur).toMatch(/Aucune préférence de langue/);
        expect((await client.query(`select public.ma_langue() as l`)).rows[0].l).toBeNull();
      });
    });

    it("le rôle anon (aucune session) ne peut pas appeler les fonctions", async () => {
      await client.query("begin");
      try {
        await client.query("set local role anon");
        for (const appel of [`select public.changer_langue('en')`, `select public.ma_langue()`]) {
          const r = await essayer(client, appel);
          expect(r.erreur, appel).toMatch(/permission denied/);
        }
      } finally {
        await client.query("rollback");
        await client.query("reset role");
      }
    });
  });

  describe("le rôle ne se modifie par aucun chemin ouvert à un non-administrateur", () => {
    for (const [nom, obtenir] of [
      ["gestionnaire", () => gestionnaire],
      ["lecteur", () => lecteur],
    ] as const) {
      describe(nom, () => {
        it("UPDATE direct de son rôle : aucune ligne touchée", async () => {
          await commeUtilisateur(client, obtenir(), async () => {
            const r = await essayer(
              client,
              `update membres set role = 'proprietaire_org' where user_id = $1`,
              [obtenir()],
            );
            expect(r.lignes).toBe(0);
            await enProprietaire(client, async () => {
              expect(await roleDe(obtenir())).toBe(nom);
            });
          });
        });

        it("UPDATE direct de sa langue : refusé aussi — la fonction est la seule voie", async () => {
          await commeUtilisateur(client, obtenir(), async () => {
            const r = await essayer(client, `update membres set langue = 'en' where user_id = $1`, [
              obtenir(),
            ]);
            expect(r.lignes).toBe(0);
            await enProprietaire(client, async () => {
              expect(await langueMembre(obtenir())).toBe("fr");
            });
          });
        });

        it("UPDATE du rôle de tout le cabinet : aucune ligne touchée", async () => {
          await commeUtilisateur(client, obtenir(), async () => {
            const r = await essayer(client, `update membres set role = 'proprietaire_org'`);
            expect(r.lignes).toBe(0);
          });
        });

        it("INSERT d'une seconde ligne membre à son nom avec un rôle supérieur : refusé", async () => {
          await commeUtilisateur(client, obtenir(), async () => {
            const r = await essayer(
              client,
              `insert into membres (organisation_id, user_id, role)
               values ($1, $2, 'proprietaire_org')`,
              [organisationId, obtenir()],
            );
            expect(r.erreur).not.toBeNull();
          });
        });

        it("INSERT d'un membre proprietaire_org pour un autre compte : refusé", async () => {
          await commeUtilisateur(client, obtenir(), async () => {
            const r = await essayer(
              client,
              `insert into membres (organisation_id, user_id, role)
               values ($1, $2, 'proprietaire_org')`,
              [organisationId, sansRattachement],
            );
            expect(r.erreur).not.toBeNull();
          });
        });

        it("DELETE de sa propre ligne : aucune ligne supprimée", async () => {
          await commeUtilisateur(client, obtenir(), async () => {
            const r = await essayer(client, `delete from membres where user_id = $1`, [obtenir()]);
            expect(r.lignes).toBe(0);
          });
        });

        it("changer_langue n'a aucun paramètre qui désigne une ligne ou un rôle", async () => {
          const { rows } = await client.query<{ args: string }>(
            `select pg_get_function_arguments(p.oid) as args
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where p.proname = 'changer_langue' and n.nspname in ('app', 'public')`,
          );
          expect(rows.length).toBe(2);
          for (const { args } of rows) expect(args).toBe("p_langue text");
        });
      });
    }

    it("la définition de app.changer_langue ne référence jamais la colonne role", async () => {
      const { rows } = await client.query<{ src: string }>(
        `select p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and p.proname = 'changer_langue'`,
      );
      const code = rows[0]!.src
        .split("\n")
        .filter((ligne) => !ligne.trim().startsWith("--"))
        .join("\n");
      expect(code).not.toMatch(/\brole\b/i);
      expect(code).toMatch(/set langue = p_langue/g);
    });
  });

  describe("langues supportées : la base et le code disent la même chose", () => {
    it("app.langues_supportees == LANGUES (lib/i18n/config.ts)", async () => {
      const { rows } = await client.query<{ code: string }>(
        `select code from app.langues_supportees order by code`,
      );
      expect(rows.map((r) => r.code)).toEqual([...LANGUES].sort());
    });

    it("la table est fermée : un utilisateur authentifié ne peut ni la lire ni l'écrire", async () => {
      await commeUtilisateur(client, gestionnaire, async () => {
        const lecture = await essayer(client, `select code from app.langues_supportees`);
        expect(lecture.erreur !== null || lecture.lignes === 0).toBe(true);
        const ecriture = await essayer(client, `insert into app.langues_supportees (code) values ('zz')`);
        expect(ecriture.erreur).not.toBeNull();
      });
    });

    it("membres.langue et proprietaires.langue refusent un format invalide", async () => {
      await client.query("begin");
      try {
        for (const requete of [
          `update membres set langue = 'francais' where user_id = '${gestionnaire}'`,
          `update proprietaires set langue = 'EN' where id = '${proprietaireB}'`,
        ]) {
          const r = await essayer(client, requete);
          expect(r.erreur, requete).toMatch(/langue_format/);
        }
      } finally {
        await client.query("rollback");
      }
    });
  });
});
