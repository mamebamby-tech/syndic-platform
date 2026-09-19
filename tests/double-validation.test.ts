import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";
import { creerSessions, essayer } from "./aides";

// Double validation des coordonnées de paiement (20260919140000).
//
// Modifier le compte, les moyens acceptés ou un numéro marchand crée une version
// EN ATTENTE, qui n'entre en vigueur qu'après confirmation par un AUTRE membre
// habilité que son auteur. Jusque-là, l'ancienne version reste en vigueur.
//
// Cabinets fictifs, validés en beforeAll puis supprimés ; chaque test tourne
// dans une transaction annulée.

const NOUVEAU = {
  titulaire: "Syndicat de la tour",
  banque: "Banque du Sahel",
  numero: "SN08 0000 1111 2222 3333",
  bic: "ABCDSNDA",
  moyens: "{wave,virement,virement_international}",
  marchands: '{"wave": "77 000 00 00"}',
};

describe("double validation des coordonnées de paiement", () => {
  let client: Client;
  let organisationId: string;
  let immeubleId: string;
  let autreOrganisationId: string;
  let soloOrganisationId: string;
  let soloImmeubleId: string;

  let alice: string; // gestionnaire
  let bob: string; // gestionnaire
  let carole: string; // proprietaire_org
  let lecteur: string;
  let eve: string; // gestionnaire d'un AUTRE cabinet
  let solo: string; // seul membre habilité de son cabinet
  let soloLecteur: string;

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
  const membre = (org: string, user: string, role: string) =>
    client.query(`insert into membres (organisation_id, user_id, role) values ($1, $2, $3)`, [org, user, role]);

  beforeAll(async () => {
    client = await connecter();
    sessions = creerSessions(client);

    organisationId = await organisation("test-dv-a");
    autreOrganisationId = await organisation("test-dv-b");
    soloOrganisationId = await organisation("test-dv-solo");
    for (const [org, nom] of [
      [organisationId, "Immeuble DV A"],
      [autreOrganisationId, "Immeuble DV B"],
      [soloOrganisationId, "Immeuble DV solo"],
    ] as const) {
      const r = await client.query<{ id: string }>(
        `insert into immeubles (organisation_id, nom) values ($1, $2) returning id`,
        [org, nom],
      );
      if (org === organisationId) immeubleId = r.rows[0]!.id;
      if (org === soloOrganisationId) soloImmeubleId = r.rows[0]!.id;
    }

    alice = await utilisateur("alice.dv@example.com");
    bob = await utilisateur("bob.dv@example.com");
    carole = await utilisateur("carole.dv@example.com");
    lecteur = await utilisateur("lecteur.dv@example.com");
    eve = await utilisateur("eve.dv@example.com");
    solo = await utilisateur("solo.dv@example.com");
    soloLecteur = await utilisateur("solo.lecteur.dv@example.com");
    await membre(organisationId, alice, "gestionnaire");
    await membre(organisationId, bob, "gestionnaire");
    await membre(organisationId, carole, "proprietaire_org");
    await membre(organisationId, lecteur, "lecteur");
    await membre(autreOrganisationId, eve, "gestionnaire");
    await membre(soloOrganisationId, solo, "proprietaire_org");
    await membre(soloOrganisationId, soloLecteur, "lecteur");
  });

  afterAll(async () => {
    await client.query(`delete from organisations where id = any($1)`, [organisations]);
    await client.query(`delete from auth.users where id = any($1)`, [utilisateurs]);
    await client.end();
  });

  const tx = (corps: () => Promise<void>) => sessions.dansTransaction(corps);
  const session = <T,>(user: string | null, corps: () => Promise<T>) => sessions.enSession(user, corps);

  const proposerSql = `select public.proposer_coordonnees_paiement($1, $2, $3, $4, $5, $6::moyen_paiement[], $7::jsonb) as id`;
  const proposer = (immeuble: string, surcharge: Partial<typeof NOUVEAU> = {}) => {
    const v = { ...NOUVEAU, ...surcharge };
    return essayer(client, proposerSql, [immeuble, v.titulaire, v.banque, v.numero, v.bic, v.moyens, v.marchands]);
  };
  // Propose ET renvoie l'id (essayer ne renvoie pas les lignes).
  const proposerId = async (immeuble: string, surcharge: Partial<typeof NOUVEAU> = {}) => {
    const v = { ...NOUVEAU, ...surcharge };
    return (await client.query<{ id: string }>(proposerSql, [immeuble, v.titulaire, v.banque, v.numero, v.bic, v.moyens, v.marchands])).rows[0]!.id;
  };
  const confirmer = (id: string) => essayer(client, `select public.confirmer_coordonnees_paiement($1)`, [id]);
  const refuser = (id: string) => essayer(client, `select public.refuser_coordonnees_paiement($1)`, [id]);

  const live = async (im = immeubleId) =>
    (
      await client.query(
        `select compte_titulaire, compte_banque, compte_numero, compte_bic, moyens_paiement_acceptes::text[] as moyens,
                numeros_marchands, compte_modifie_le from immeubles where id = $1`,
        [im],
      )
    ).rows[0];
  const version = async (id: string) => (await client.query(`select * from coordonnees_paiement_versions where id = $1`, [id])).rows[0];
  const versions = async (im = immeubleId) =>
    (await client.query(`select * from coordonnees_paiement_versions where immeuble_id = $1 order by propose_le`, [im])).rows;
  const journal = async (action: string, im = immeubleId) =>
    (await client.query(`select * from journal where entite_id = $1 and action = $2 order by cree_le, id`, [im, action])).rows;

  describe("1. une modification crée une version en attente ; rien n'entre en vigueur", () => {
    it("proposer laisse les coordonnées en vigueur INCHANGÉES et crée une version en attente", async () => {
      await tx(async () => {
        await session(alice, async () => {
          const r = await proposer(immeubleId);
          expect(r.erreur).toBeNull();
        });
        const l = await live();
        expect(l.compte_numero).toBeNull();
        expect(l.compte_titulaire).toBeNull();
        expect(l.moyens).toEqual([]);
        expect(l.compte_modifie_le).toBeNull();

        const [v] = await versions();
        expect(v.statut).toBe("en_attente");
        expect(v.compte_numero).toBe(NOUVEAU.numero);
        expect(v.propose_par).toBe(alice);
        expect(v.propose_par_libelle).toBe("alice.dv@example.com");
        expect(v.decide_par).toBeNull();
      });
    });

    it("la proposition est tracée (avant = en vigueur, après = proposé, auteur = celui qui propose)", async () => {
      await tx(async () => {
        await session(alice, async () => {
          await proposer(immeubleId);
        });
        const [j] = await journal("coordonnees_paiement_proposees");
        expect(j.acteur_id).toBe(alice);
        expect(j.avant.compte_numero).toBeNull();
        expect(j.apres.compte_numero).toBe(NOUVEAU.numero);
        expect(j.apres.numeros_marchands).toEqual({ wave: "77 000 00 00" });
        // Rien n'est encore « modifié » : pas de trace d'entrée en vigueur.
        expect(await journal("coordonnees_paiement_modifiees")).toHaveLength(0);
      });
    });

    it("un utilisateur ne peut plus écrire les coordonnées en vigueur directement", async () => {
      await tx(async () => {
        await session(alice, async () => {
          const r = await essayer(client, `update immeubles set compte_numero = 'X' where id = $1`, [immeubleId]);
          expect(r.erreur).toMatch(/permission denied/);
        });
        expect((await live()).compte_numero).toBeNull();
      });
    });

    it("les coordonnées en vigueur ne changent pas non plus en modifiant les moyens ou les numéros marchands", async () => {
      await tx(async () => {
        await session(alice, async () => {
          for (const affectation of [`moyens_paiement_acceptes = '{wave}'`, `numeros_marchands = '{}'::jsonb`]) {
            expect((await essayer(client, `update immeubles set ${affectation} where id = $1`, [immeubleId])).erreur).toMatch(
              /permission denied/,
            );
          }
        });
      });
    });

    it("refuse de proposer ce qui est déjà en vigueur : « aucun changement »", async () => {
      await tx(async () => {
        await client.query(
          `update immeubles set compte_titulaire = $2, compte_banque = $3, compte_numero = $4, compte_bic = $5,
             moyens_paiement_acceptes = $6::moyen_paiement[], numeros_marchands = $7::jsonb where id = $1`,
          [immeubleId, NOUVEAU.titulaire, NOUVEAU.banque, NOUVEAU.numero, NOUVEAU.bic, NOUVEAU.moyens, NOUVEAU.marchands],
        );
        await session(alice, async () => {
          expect((await proposer(immeubleId)).erreur).toMatch(/Aucun changement/);
          // Des espaces en trop ne sont pas un changement.
          expect((await proposer(immeubleId, { titulaire: `  ${NOUVEAU.titulaire}  ` })).erreur).toMatch(/Aucun changement/);
        });
        expect(await versions()).toHaveLength(0);
      });
    });

    it("une proposition invalide est refusée à la proposition, sans laisser de version", async () => {
      await tx(async () => {
        await session(alice, async () => {
          expect((await proposer(immeubleId, { bic: "abc" })).erreur).toMatch(/versions_bic_format/);
          expect((await proposer(immeubleId, { bic: "", moyens: "{virement_international}", marchands: "{}" })).erreur).toMatch(
            /versions_swift_requis/,
          );
          expect((await proposer(immeubleId, { moyens: "{virement}", marchands: '{"wave": "1"}' })).erreur).toMatch(
            /versions_numeros_marchands_valides/,
          );
        });
        expect(await versions()).toHaveLength(0);
      });
    });

    it("une nouvelle proposition remplace celle qui attendait : une seule en attente à la fois", async () => {
      await tx(async () => {
        let premiere = "";
        await session(alice, async () => {
          premiere = await proposerId(immeubleId, { numero: "PREMIER" });
          await proposerId(immeubleId, { numero: "SECOND" });
        });
        expect((await version(premiere)).statut).toBe("remplacee");
        const attente = (await versions()).filter((v) => v.statut === "en_attente");
        expect(attente).toHaveLength(1);
        expect(attente[0].compte_numero).toBe("SECOND");
      });
    });

    it("la base refuse deux versions en attente pour un même immeuble (même par SQL direct)", async () => {
      await tx(async () => {
        await session(alice, async () => {
          await proposerId(immeubleId);
        });
        const r = await essayer(client, `insert into coordonnees_paiement_versions (immeuble_id) values ($1)`, [immeubleId]);
        expect(r.erreur).toMatch(/versions_une_en_attente/);
      });
    });
  });

  describe("2. l'auteur ne peut pas confirmer sa propre modification", () => {
    it("refusé pour un gestionnaire comme pour un proprietaire_org, la version reste en attente", async () => {
      for (const auteur of [alice, carole]) {
        await tx(async () => {
          let id = "";
          await session(auteur, async () => {
            id = await proposerId(immeubleId);
            const r = await confirmer(id);
            expect(r.erreur).toMatch(/auteur d'une modification ne peut pas la confirmer/);
          });
          expect((await version(id)).statut).toBe("en_attente");
          expect((await live()).compte_numero).toBeNull();
        });
      }
    });

    it("la règle tient AUSSI par SQL direct : contrainte de table, sans passer par la fonction", async () => {
      await tx(async () => {
        let id = "";
        await session(alice, async () => {
          id = await proposerId(immeubleId);
        });
        const r = await essayer(
          client,
          `update coordonnees_paiement_versions set statut = 'en_vigueur', decide_par = propose_par, decide_le = now() where id = $1`,
          [id],
        );
        expect(r.erreur).toMatch(/versions_auteur_ne_confirme_pas/);
      });
    });

    it("l'auteur peut en revanche retirer sa propre demande", async () => {
      await tx(async () => {
        let id = "";
        await session(alice, async () => {
          id = await proposerId(immeubleId);
          expect((await refuser(id)).erreur).toBeNull();
        });
        expect((await version(id)).statut).toBe("refusee");
      });
    });
  });

  describe("3. un autre membre habilité confirme : la version entre en vigueur", () => {
    // Identités résolues à l'EXÉCUTION : alice, bob, carole n'existent qu'après beforeAll.
    for (const [nomAuteur, nomConfirmateur, libelle] of [
      ["alice", "bob", "gestionnaire confirmé par un gestionnaire"],
      ["alice", "carole", "gestionnaire confirmé par le proprietaire_org"],
      ["carole", "alice", "proprietaire_org confirmé par un gestionnaire"],
    ] as const) {
      it(`${libelle}`, async () => {
        const identites = { alice, bob, carole };
        const auteur = identites[nomAuteur];
        const confirmateur = identites[nomConfirmateur];
        await tx(async () => {
          let id = "";
          await session(auteur, async () => {
            id = await proposerId(immeubleId);
          });
          await session(confirmateur, async () => {
            expect((await confirmer(id)).erreur).toBeNull();
          });

          const l = await live();
          expect(l.compte_titulaire).toBe(NOUVEAU.titulaire);
          expect(l.compte_banque).toBe(NOUVEAU.banque);
          expect(l.compte_numero).toBe(NOUVEAU.numero);
          expect(l.compte_bic).toBe(NOUVEAU.bic);
          expect(l.moyens).toEqual(["wave", "virement", "virement_international"]);
          expect(l.numeros_marchands).toEqual({ wave: "77 000 00 00" });
          expect(l.compte_modifie_le).not.toBeNull();

          const v = await version(id);
          expect(v.statut).toBe("en_vigueur");
          expect(v.propose_par).toBe(auteur);
          expect(v.decide_par).toBe(confirmateur);
          expect(v.decide_par).not.toBe(v.propose_par);
        });
      });
    }

    it("l'entrée en vigueur est tracée avec, pour auteur, CELUI QUI CONFIRME", async () => {
      await tx(async () => {
        let id = "";
        await session(alice, async () => {
          id = await proposerId(immeubleId);
        });
        await session(bob, async () => {
          await confirmer(id);
        });
        const [j] = await journal("coordonnees_paiement_modifiees");
        expect(j.acteur_id).toBe(bob);
        expect(j.acteur_libelle).toBe("bob.dv@example.com");
        expect(j.apres.compte_numero).toBe(NOUVEAU.numero);
        // La proposition, elle, garde son auteur.
        expect((await journal("coordonnees_paiement_proposees"))[0].acteur_id).toBe(alice);
      });
    });

    it("la version précédente en vigueur devient « remplacée » : une seule en vigueur", async () => {
      await tx(async () => {
        let v1 = "";
        let v2 = "";
        await session(alice, async () => {
          v1 = await proposerId(immeubleId, { numero: "PREMIER" });
        });
        await session(bob, async () => {
          await confirmer(v1);
        });
        await session(bob, async () => {
          v2 = await proposerId(immeubleId, { numero: "SECOND" });
        });
        await session(alice, async () => {
          await confirmer(v2);
        });
        expect((await version(v1)).statut).toBe("remplacee");
        expect((await version(v2)).statut).toBe("en_vigueur");
        expect((await live()).compte_numero).toBe("SECOND");
        expect((await versions()).filter((v) => v.statut === "en_vigueur")).toHaveLength(1);
      });
    });

    it("on ne confirme pas deux fois, ni une version refusée ou remplacée", async () => {
      await tx(async () => {
        let v1 = "";
        let v2 = "";
        await session(alice, async () => {
          v1 = await proposerId(immeubleId, { numero: "PREMIER" });
          v2 = await proposerId(immeubleId, { numero: "SECOND" }); // v1 est remplacée
        });
        await session(bob, async () => {
          expect((await confirmer(v1)).erreur).toMatch(/plus en attente/);
          expect((await confirmer(v2)).erreur).toBeNull();
          expect((await confirmer(v2)).erreur).toMatch(/plus en attente/);
        });
        expect((await live()).compte_numero).toBe("SECOND");
      });
    });

    it("un confirmateur lit ce qu'il confirme : la version désigne exactement les valeurs proposées", async () => {
      await tx(async () => {
        let id = "";
        await session(alice, async () => {
          id = await proposerId(immeubleId, { numero: "IBAN-QUE-BOB-A-VU" });
          // Remplacée après coup : bob, qui avait vu la version précédente, ne peut pas
          // confirmer à l'aveugle la nouvelle en croyant confirmer l'ancienne.
          await proposerId(immeubleId, { numero: "IBAN-SUBSTITUE" });
        });
        await session(bob, async () => {
          expect((await confirmer(id)).erreur).toMatch(/plus en attente/);
        });
        expect((await live()).compte_numero).toBeNull();
      });
    });
  });

  describe("4. qui peut proposer, confirmer, refuser", () => {
    it("un lecteur ne peut ni proposer, ni confirmer, ni refuser", async () => {
      await tx(async () => {
        let id = "";
        await session(alice, async () => {
          id = await proposerId(immeubleId);
        });
        await session(lecteur, async () => {
          expect((await proposer(immeubleId)).erreur).toMatch(/Non autorisé/);
          expect((await confirmer(id)).erreur).toMatch(/Non autorisé/);
          expect((await refuser(id)).erreur).toMatch(/Non autorisé/);
        });
        expect((await version(id)).statut).toBe("en_attente");
      });
    });

    it("un gestionnaire d'un autre cabinet ne peut rien, et ne voit rien", async () => {
      await tx(async () => {
        let id = "";
        await session(alice, async () => {
          id = await proposerId(immeubleId);
        });
        await session(eve, async () => {
          expect((await proposer(immeubleId)).erreur).toMatch(/Non autorisé/);
          expect((await confirmer(id)).erreur).toMatch(/Non autorisé/);
          expect((await refuser(id)).erreur).toMatch(/Non autorisé/);
          const lecture = await client.query(`select id from coordonnees_paiement_versions where immeuble_id = $1`, [immeubleId]);
          expect(lecture.rowCount).toBe(0);
        });
        expect((await version(id)).statut).toBe("en_attente");
      });
    });

    it("sans session, rien n'est possible", async () => {
      await tx(async () => {
        let id = "";
        await session(alice, async () => {
          id = await proposerId(immeubleId);
        });
        await session(null, async () => {
          expect((await proposer(immeubleId)).erreur).toMatch(/Non authentifié/);
          expect((await confirmer(id)).erreur).toMatch(/Non authentifié/);
          expect((await refuser(id)).erreur).toMatch(/Non authentifié/);
        });
      });
    });

    it("le rôle anon (aucune session) n'a pas le droit d'exécuter les fonctions", async () => {
      await tx(async () => {
        await client.query("set local role anon");
        for (const appel of [
          `select public.confirmer_coordonnees_paiement(gen_random_uuid())`,
          `select public.refuser_coordonnees_paiement(gen_random_uuid())`,
        ]) {
          expect((await essayer(client, appel)).erreur, appel).toMatch(/permission denied/);
        }
        await client.query("reset role");
      });
    });

    it("le personnel lit les versions de son cabinet mais ne les écrit pas directement", async () => {
      await tx(async () => {
        let id = "";
        await session(alice, async () => {
          id = await proposerId(immeubleId);
        });
        for (const utilisateurTest of [lecteur, bob, carole]) {
          await session(utilisateurTest, async () => {
            expect((await client.query(`select id from coordonnees_paiement_versions where id = $1`, [id])).rowCount).toBe(1);
            for (const sql of [
              `update coordonnees_paiement_versions set statut = 'en_vigueur' where id = $1`,
              `delete from coordonnees_paiement_versions where id = $1`,
              `update coordonnees_paiement_versions set compte_numero = 'PIRATE' where id = $1`,
            ]) {
              expect((await essayer(client, sql, [id])).erreur, sql).toMatch(/permission denied/);
            }
            expect(
              (await essayer(client, `insert into coordonnees_paiement_versions (immeuble_id, statut, decide_le) values ($1, 'en_vigueur', now())`, [immeubleId]))
                .erreur,
            ).toMatch(/permission denied/);
          });
        }
        expect((await version(id)).compte_numero).toBe(NOUVEAU.numero);
      });
    });
  });

  describe("5. refuser : l'ancienne version reste en vigueur", () => {
    it("un autre membre refuse : la version est écartée, rien ne change, la trace le dit", async () => {
      await tx(async () => {
        let id = "";
        await session(alice, async () => {
          id = await proposerId(immeubleId);
        });
        await session(bob, async () => {
          expect((await refuser(id)).erreur).toBeNull();
        });
        const v = await version(id);
        expect(v.statut).toBe("refusee");
        expect(v.decide_par).toBe(bob);
        expect((await live()).compte_numero).toBeNull();
        const [j] = await journal("coordonnees_paiement_refusees");
        expect(j.acteur_id).toBe(bob);
        expect(j.apres.compte_numero).toBe(NOUVEAU.numero);
        expect((await journal("coordonnees_paiement_modifiees"))).toHaveLength(0);
      });
    });

    it("une version refusée ne se confirme plus ; une nouvelle proposition reste possible", async () => {
      await tx(async () => {
        let id = "";
        await session(alice, async () => {
          id = await proposerId(immeubleId);
        });
        await session(bob, async () => {
          await refuser(id);
          expect((await confirmer(id)).erreur).toMatch(/plus en attente/);
          expect((await refuser(id)).erreur).toMatch(/plus en attente/);
        });
        await session(alice, async () => {
          expect((await proposer(immeubleId, { numero: "CORRIGE" })).erreur).toBeNull();
        });
      });
    });
  });

  describe("6. un seul membre habilité : la règle n'est PAS contournée", () => {
    it("il peut proposer, mais personne ne peut confirmer : la version reste en attente", async () => {
      await tx(async () => {
        let id = "";
        await session(solo, async () => {
          id = await proposerId(soloImmeubleId);
          expect((await confirmer(id)).erreur).toMatch(/auteur d'une modification ne peut pas la confirmer/);
        });
        await session(soloLecteur, async () => {
          expect((await confirmer(id)).erreur).toMatch(/Non autorisé/);
        });
        expect((await version(id)).statut).toBe("en_attente");
        expect((await live(soloImmeubleId)).compte_numero).toBeNull();
      });
    });

    it("il ne peut pas non plus écrire directement : aucune porte dérobée pour le cabinet à un seul habilité", async () => {
      await tx(async () => {
        await session(solo, async () => {
          const r = await essayer(client, `update immeubles set compte_numero = 'X' where id = $1`, [soloImmeubleId]);
          expect(r.erreur).toMatch(/permission denied/);
        });
      });
    });

    it("dès qu'un second membre habilité rejoint le cabinet, la confirmation devient possible", async () => {
      await tx(async () => {
        let id = "";
        await session(solo, async () => {
          id = await proposerId(soloImmeubleId);
        });
        const second = await client.query<{ id: string }>(`insert into auth.users (id, email) values (gen_random_uuid(), 'second.dv@example.com') returning id`);
        await client.query(`insert into membres (organisation_id, user_id, role) values ($1, $2, 'gestionnaire')`, [soloOrganisationId, second.rows[0]!.id]);
        await session(second.rows[0]!.id, async () => {
          expect((await confirmer(id)).erreur).toBeNull();
        });
        expect((await live(soloImmeubleId)).compte_numero).toBe(NOUVEAU.numero);
      });
    });
  });

  describe("7. concurrence", () => {
    it("deux membres qui confirment en même temps : l'un réussit, l'autre est refusé, une seule entrée en vigueur", async () => {
      const client2 = await connecter();
      const org = await organisation("test-dv-concurrence");
      const im = await client.query<{ id: string }>(`insert into immeubles (organisation_id, nom) values ($1, 'DV concurrence') returning id`, [org]);
      const [u1, u2, u3] = [await utilisateur("c1.dv@example.com"), await utilisateur("c2.dv@example.com"), await utilisateur("c3.dv@example.com")];
      for (const u of [u1, u2, u3]) await membre(org, u, "gestionnaire");

      // Version en attente, validée (committée) pour que la seconde connexion la voie.
      const proposition = await client.query<{ id: string }>(
        `insert into coordonnees_paiement_versions (immeuble_id, compte_titulaire, compte_banque, compte_numero, propose_par)
         values ($1, 'T', 'B', 'N', $2) returning id`,
        [im.rows[0]!.id, u1],
      );
      const id = proposition.rows[0]!.id;

      const ouvrir = async (c: Client, utilisateurId: string) => {
        await c.query("begin");
        await c.query("set local role authenticated");
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: utilisateurId })]);
      };
      try {
        await ouvrir(client, u2);
        await ouvrir(client2, u3);

        // u2 confirme : il tient le verrou de l'immeuble jusqu'à son commit.
        await client.query(`select public.confirmer_coordonnees_paiement($1)`, [id]);

        // u3 confirme la même version : il doit ATTENDRE, puis constater qu'elle n'est plus en attente.
        const t2 = client2
          .query(`select public.confirmer_coordonnees_paiement($1)`, [id])
          .then(() => "ok" as const, (e: Error) => e.message);
        const attente = await Promise.race([t2, new Promise<"attend">((r) => setTimeout(() => r("attend"), 500))]);
        expect(attente).toBe("attend");

        await client.query("commit");
        expect(await t2).toMatch(/plus en attente/);
        await client2.query("rollback");

        await client.query("reset role");
        const { rows } = await client.query(
          `select count(*)::int as n from coordonnees_paiement_versions where immeuble_id = $1 and statut = 'en_vigueur'`,
          [im.rows[0]!.id],
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

// ---------------------------------------------------------------------------
// Bout en bout, sur un vrai appel : « en attendant, les appels utilisent
// l'ancienne version ».
// ---------------------------------------------------------------------------

describe("pendant qu'une modification attend, les appels utilisent l'ancienne version", () => {
  let client: Client;
  let sessions: ReturnType<typeof creerSessions>;
  let immeubleId: string;
  let periodeId: string;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    client = await connecter();
    // Une transaction pour tout ce bloc, annulée en afterAll : il modifie les
    // coordonnées et les appels de l'immeuble de dev.
    sessions = creerSessions(client, { dejaEnTransaction: true });
    await client.query("begin");
    const im = await client.query<{ id: string; organisation_id: string }>(
      `select id, organisation_id from immeubles where nom = 'Mamelles Tower'`,
    );
    immeubleId = im.rows[0]!.id;
    const users: string[] = [];
    for (const email of ["e2e.alice.dv@example.com", "e2e.bob.dv@example.com"]) {
      const u = await client.query<{ id: string }>(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email]);
      await client.query(`insert into membres (organisation_id, user_id, role) values ($1, $2, 'gestionnaire')`, [im.rows[0]!.organisation_id, u.rows[0]!.id]);
      users.push(u.rows[0]!.id);
    }
    [alice, bob] = users as [string, string];

    const postes = await client.query<{ id: string }>(
      `select pc.id from postes_charges pc join cles_repartition cr on cr.id = pc.cle_repartition_id
       where pc.immeuble_id = $1 and cr.code = 'tantiemes' and pc.categorie = 'general' order by pc.ordre limit 2`,
      [immeubleId],
    );
    const ex = await client.query<{ id: string }>(
      `insert into exercices (immeuble_id, libelle, date_debut, date_fin) values ($1, 'Exercice test DV', '2031-01-01', '2031-12-31') returning id`,
      [immeubleId],
    );
    const per = await client.query<{ id: string }>(
      `insert into periodes (exercice_id, libelle, date_debut, date_fin, date_echeance)
       values ($1, 'Période test DV', '2031-01-01', '2031-03-31', '2031-01-01') returning id`,
      [ex.rows[0]!.id],
    );
    periodeId = per.rows[0]!.id;
    for (const p of postes.rows) {
      await client.query(`insert into budget_lignes (periode_id, poste_charge_id, montant) values ($1, $2, 100000)`, [periodeId, p.id]);
    }
    // Coordonnées EN VIGUEUR (script, dans la transaction).
    await client.query(
      `update immeubles set compte_titulaire = 'Syndicat', compte_banque = 'Banque', compte_numero = 'IBAN-EN-VIGUEUR',
         compte_bic = null, moyens_paiement_acceptes = '{virement}', numeros_marchands = '{}' where id = $1`,
      [immeubleId],
    );
    await client.query(`select app.generer_appels($1)`, [periodeId]);
  });

  afterAll(async () => {
    await client.query("rollback");
    await client.end();
  });

  const emis = async (n: number) => {
    const { rows } = await client.query<{ id: string }>(
      `select id from appels where periode_id = $1 and statut = 'brouillon' order by numero offset $2 limit 1`,
      [periodeId, n],
    );
    await client.query(`update appels set statut = 'emis' where id = $1`, [rows[0]!.id]);
    return (await client.query(`select instantane from appels where id = $1`, [rows[0]!.id])).rows[0].instantane;
  };

  it("un appel émis pendant l'attente porte l'ANCIEN IBAN ; celui émis après confirmation, le nouveau ; le premier ne change pas", async () => {
    let id = "";
    await sessions.enSession(alice, async () => {
      id = (
        await client.query<{ id: string }>(
          `select public.proposer_coordonnees_paiement($1, 'Syndicat', 'Banque', 'IBAN-NOUVEAU-EN-ATTENTE', null, '{virement}'::moyen_paiement[], '{}'::jsonb) as id`,
          [immeubleId],
        )
      ).rows[0]!.id;
    });

    // La version attend : l'émission fige l'ancienne.
    const pendant = await emis(0);
    expect(pendant.reglement.compte.numero).toBe("IBAN-EN-VIGUEUR");

    await sessions.enSession(bob, async () => {
      await client.query(`select public.confirmer_coordonnees_paiement($1)`, [id]);
    });

    // Confirmée : le prochain appel émis porte la nouvelle...
    const apres = await emis(0);
    expect(apres.reglement.compte.numero).toBe("IBAN-NOUVEAU-EN-ATTENTE");

    // ...et le premier, émis avant, n'a pas bougé.
    const relu = (
      await client.query(`select instantane from appels where periode_id = $1 and instantane->>'reference' = $2`, [periodeId, pendant.reference])
    ).rows[0].instantane;
    expect(relu).toEqual(pendant);
    expect(relu.reglement.compte.numero).toBe("IBAN-EN-VIGUEUR");
  });
});
