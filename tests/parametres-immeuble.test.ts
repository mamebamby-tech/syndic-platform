import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";
import { essayer } from "./aides";
import {
  codePeriode,
  codeReferenceValide,
  formatReferenceValide,
} from "@/lib/parametres/reference";
import type { Periodicite } from "@/lib/types/database";

// Paramètres de l'immeuble : coordonnées de paiement, moyens, numéros
// marchands, format de la référence.
//
// Un IBAN modifié par la mauvaise personne redirige l'argent de tous les
// copropriétaires sans qu'aucun calcul ne soit faux. Ce fichier vérifie les
// trois garde-fous, tous en base (20260919110000_parametres_immeuble.sql) :
//   1. QUI peut modifier (RLS) : un lecteur ne le peut pas ;
//   2. chaque modification laisse une trace dans `journal` ;
//   3. la date de dernière modification est posée par la base, jamais saisie.
//
// Tout se passe sur des cabinets fictifs ; chaque test s'exécute dans une
// transaction annulée.

describe("paramètres de l'immeuble — droits, trace, contraintes", () => {
  let client: Client;
  let organisationId: string;
  let autreOrganisationId: string;
  let immeubleId: string;
  let autreImmeubleId: string;

  let gestionnaire: string;
  let lecteur: string;
  let proprietaireOrg: string;
  let coproprietaire: string;
  let gestionnaireAutreCabinet: string;

  const utilisateurs: string[] = [];
  const organisations: string[] = [];

  async function utilisateur(email: string | null): Promise<string> {
    const r = await client.query<{ id: string }>(
      `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
      [email],
    );
    utilisateurs.push(r.rows[0]!.id);
    return r.rows[0]!.id;
  }

  beforeAll(async () => {
    client = await connecter();

    const orgs = [];
    for (const slug of ["test-parametres-a", "test-parametres-b"]) {
      const r = await client.query<{ id: string }>(
        `insert into organisations (nom, slug) values ($1, $2) returning id`,
        [`Cabinet ${slug}`, slug],
      );
      organisations.push(r.rows[0]!.id);
      orgs.push(r.rows[0]!.id);
    }
    [organisationId, autreOrganisationId] = orgs as [string, string];

    const immeubles = [];
    for (const [org, nom] of [
      [organisationId, "Immeuble test paramètres A"],
      [autreOrganisationId, "Immeuble test paramètres B"],
    ] as const) {
      const r = await client.query<{ id: string }>(
        `insert into immeubles (organisation_id, nom) values ($1, $2) returning id`,
        [org, nom],
      );
      immeubles.push(r.rows[0]!.id);
    }
    [immeubleId, autreImmeubleId] = immeubles as [string, string];

    gestionnaire = await utilisateur("gestionnaire.test@example.com");
    lecteur = await utilisateur("lecteur.test@example.com");
    proprietaireOrg = await utilisateur("proprietaire.test@example.com");
    coproprietaire = await utilisateur(null);
    gestionnaireAutreCabinet = await utilisateur("autre.cabinet@example.com");

    for (const [org, user, role] of [
      [organisationId, gestionnaire, "gestionnaire"],
      [organisationId, lecteur, "lecteur"],
      [organisationId, proprietaireOrg, "proprietaire_org"],
      [autreOrganisationId, gestionnaireAutreCabinet, "gestionnaire"],
    ] as const) {
      await client.query(
        `insert into membres (organisation_id, user_id, role) values ($1, $2, $3)`,
        [org, user, role],
      );
    }

    const proprio = await client.query<{ id: string }>(
      `insert into proprietaires (immeuble_id, nom) values ($1, 'Copropriétaire test') returning id`,
      [immeubleId],
    );
    await client.query(`insert into acces_personnes (user_id, proprietaire_id) values ($1, $2)`, [
      coproprietaire,
      proprio.rows[0]!.id,
    ]);
  });

  afterAll(async () => {
    // Supprimer les cabinets emporte immeubles, membres et journal ; puis les comptes.
    await client.query(`delete from organisations where id = any($1)`, [organisations]);
    await client.query(`delete from auth.users where id = any($1)`, [utilisateurs]);
    await client.end();
  });

  // Transaction annulée en sortie : aucune écriture ne survit au test.
  let enTransaction = false;
  const dansTransaction = async (corps: () => Promise<void>) => {
    await client.query("begin");
    enTransaction = true;
    try {
      await corps();
    } finally {
      enTransaction = false;
      await client.query("rollback");
    }
  };

  // Agit « comme » un utilisateur (ce que PostgREST fait à chaque requête) DANS
  // la transaction courante : on change de rôle, on ne referme rien. À ne pas
  // remplacer par commeUtilisateur(), qui ouvre puis annule sa propre
  // transaction — et emporterait celle du test avec lui.
  const enSession = async <T>(utilisateurId: string | null, corps: () => Promise<T>): Promise<T> => {
    const propre = !enTransaction;
    if (propre) await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(utilisateurId ? { sub: utilisateurId } : {}),
    ]);
    try {
      return await corps();
    } finally {
      await client.query("reset role");
      if (propre) await client.query("rollback");
    }
  };

  // Agit sous l'IDENTITÉ d'un acteur (auth.uid()) sans changer de rôle. Depuis la
  // double validation (20260919140000), aucun utilisateur n'a plus le droit
  // d'écrire les coordonnées en vigueur : les déclencheurs de trace et de date,
  // eux, restent à tester — ils tracent aussi bien la confirmation d'une version
  // que la modification faite par un script, sous l'identité de qui agit.
  const agirComme = async <T,>(utilisateurId: string | null, corps: () => Promise<T>): Promise<T> => {
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(utilisateurId ? { sub: utilisateurId } : {}),
    ]);
    try {
      return await corps();
    } finally {
      await client.query("select set_config('request.jwt.claims', '{}', true)");
    }
  };

  const immeuble = async () =>
    (
      await client.query(
        // Les énumérations en tableau reviennent en chaîne « {a,b} » : on les lit en texte[].
        `select *, moyens_paiement_acceptes::text[] as moyens from immeubles where id = $1`,
        [immeubleId],
      )
    ).rows[0];
  const journal = async (action?: string) =>
    (
      await client.query(
        `select * from journal where entite = 'immeubles' and entite_id = $1
         and ($2::text is null or action = $2) order by cree_le, id`,
        [immeubleId, action ?? null],
      )
    ).rows;

  // Une modification de chaque champ de paiement, avec sa valeur d'origine
  // (dans le jeu de départ) et une nouvelle valeur.
  const MODIFICATIONS: [string, string, unknown][] = [
    ["compte_titulaire", `compte_titulaire = 'Syndicat de test'`, "Syndicat de test"],
    ["compte_banque", `compte_banque = 'Banque de test'`, "Banque de test"],
    ["compte_numero", `compte_numero = 'SN08 0000 1111 2222'`, "SN08 0000 1111 2222"],
    ["compte_bic", `compte_bic = 'ABCDSNDA'`, "ABCDSNDA"],
  ];

  describe("1. qui peut modifier — un lecteur ne peut pas", () => {
    const AUTRES: [string, string][] = [
      ["le titulaire", `compte_titulaire = 'Intrus'`],
      ["la banque", `compte_banque = 'Banque de l''intrus'`],
      ["le numéro de compte", `compte_numero = 'FR76 0000 0000 0000'`],
      ["le code SWIFT", `compte_bic = 'INTRUSXX'`],
      ["les moyens acceptés", `moyens_paiement_acceptes = '{wave}'`],
      [
        "les numéros marchands",
        `moyens_paiement_acceptes = '{wave}', numeros_marchands = '{"wave": "770000000"}'`,
      ],
      ["le code de référence", `code_reference = 'XX'`],
      ["le format de la référence", `format_reference_appel = 'XX-{seq}'`],
      ["le nom de l'immeuble", `nom = 'Renommé par un lecteur'`],
    ];

    for (const [libelle, affectation] of AUTRES) {
      it(`un lecteur ne peut pas modifier ${libelle}`, async () => {
        await dansTransaction(async () => {
          await enSession(lecteur, async () => {
            const r = await essayer(client, `update immeubles set ${affectation} where id = $1`, [
              immeubleId,
            ]);
            expect(r.lignes).toBe(0);
          });
          await client.query("reset role");
          const apres = await immeuble();
          expect(apres.compte_numero).toBeNull();
          expect(apres.moyens).toEqual([]);
          expect(apres.nom).toBe("Immeuble test paramètres A");
          expect(await journal()).toHaveLength(0);
        });
      });
    }

    it("un lecteur ne peut pas modifier toutes les coordonnées en une seule requête", async () => {
      await enSession(lecteur, async () => {
        const r = await essayer(
          client,
          `update immeubles set compte_titulaire = 'X', compte_banque = 'X', compte_numero = 'X',
             compte_bic = 'ABCDSNDA' where id = $1`,
          [immeubleId],
        );
        expect(r.lignes).toBe(0);
        // ...ni sans filtre : aucune ligne visible en écriture.
        const tout = await essayer(client, `update immeubles set compte_numero = 'X'`);
        expect(tout.lignes).toBe(0);
      });
    });

    it("un lecteur peut LIRE les paramètres", async () => {
      await enSession(lecteur, async () => {
        const r = await client.query(`select id, compte_numero, moyens_paiement_acceptes from immeubles where id = $1`, [
          immeubleId,
        ]);
        expect(r.rowCount).toBe(1);
      });
    });

    it("un lecteur ne peut ni créer ni supprimer d'immeuble", async () => {
      await enSession(lecteur, async () => {
        const creation = await essayer(
          client,
          `insert into immeubles (organisation_id, nom) values ($1, 'Intrus')`,
          [organisationId],
        );
        expect(creation.erreur).not.toBeNull();
        const suppression = await essayer(client, `delete from immeubles where id = $1`, [immeubleId]);
        expect(suppression.lignes).toBe(0);
      });
    });

    it("un gestionnaire ne peut plus modifier directement les coordonnées de paiement : la seule voie est proposer puis confirmer", async () => {
      await dansTransaction(async () => {
        await enSession(gestionnaire, async () => {
          for (const affectation of [
            `compte_titulaire = 'X'`,
            `compte_banque = 'X'`,
            `compte_numero = 'X'`,
            `compte_bic = 'ABCDSNDA'`,
            `moyens_paiement_acceptes = '{wave}'`,
            `numeros_marchands = '{}'::jsonb`,
            `compte_modifie_le = now()`,
          ]) {
            const r = await essayer(client, `update immeubles set ${affectation} where id = $1`, [immeubleId]);
            expect(r.erreur, affectation).toMatch(/permission denied/);
          }
        });
      });
    });

    it("un proprietaire_org non plus : le droit d'écriture des coordonnées est retiré à tous les utilisateurs", async () => {
      await dansTransaction(async () => {
        await enSession(proprietaireOrg, async () => {
          const r = await essayer(client, `update immeubles set compte_numero = 'X' where id = $1`, [immeubleId]);
          expect(r.erreur).toMatch(/permission denied/);
        });
      });
    });

    it("un gestionnaire peut modifier le reste de l'immeuble, mais ni créer ni supprimer d'immeuble (proprietaire_org seul)", async () => {
      await enSession(gestionnaire, async () => {
        const modif = await essayer(client, `update immeubles set ville = 'Dakar' where id = $1`, [
          immeubleId,
        ]);
        expect(modif.lignes).toBe(1);
        const creation = await essayer(
          client,
          `insert into immeubles (organisation_id, nom) values ($1, 'Nouveau')`,
          [organisationId],
        );
        expect(creation.erreur).not.toBeNull();
        const suppression = await essayer(client, `delete from immeubles where id = $1`, [immeubleId]);
        expect(suppression.lignes).toBe(0);
      });
    });

    it("un proprietaire_org peut modifier le reste de l'immeuble, créer et supprimer", async () => {
      await enSession(proprietaireOrg, async () => {
        const modif = await essayer(client, `update immeubles set ville = 'Dakar' where id = $1`, [
          immeubleId,
        ]);
        expect(modif.lignes).toBe(1);
        const creation = await essayer(
          client,
          `insert into immeubles (organisation_id, nom) values ($1, 'Nouveau') returning id`,
          [organisationId],
        );
        expect(creation.erreur).toBeNull();
        const suppression = await essayer(client, `delete from immeubles where nom = 'Nouveau'`);
        expect(suppression.lignes).toBe(1);
      });
    });

    it("un gestionnaire ne peut pas déplacer un immeuble vers un autre cabinet", async () => {
      await enSession(gestionnaire, async () => {
        const r = await essayer(client, `update immeubles set organisation_id = $2 where id = $1`, [
          immeubleId,
          autreOrganisationId,
        ]);
        expect(r.erreur).toMatch(/row-level security/);
      });
    });

    it("un gestionnaire d'un autre cabinet ne voit rien et ne modifie rien", async () => {
      await enSession(gestionnaireAutreCabinet, async () => {
        const lecture = await client.query(`select id from immeubles where id = $1`, [immeubleId]);
        expect(lecture.rowCount).toBe(0);
        const modif = await essayer(client, `update immeubles set compte_numero = 'X' where id = $1`, [
          immeubleId,
        ]);
        expect(modif.lignes).toBe(0);
        const trace = await client.query(`select id from journal where entite_id = $1`, [immeubleId]);
        expect(trace.rowCount).toBe(0);
      });
    });

    it("sans session, aucune modification n'aboutit", async () => {
      await enSession(null, async () => {
        const r = await essayer(client, `update immeubles set compte_numero = 'X' where id = $1`, [immeubleId]);
        expect(r.lignes).toBe(0);
      });
    });

    it("un copropriétaire lit où payer et quand cela a changé, sans pouvoir le modifier ni lire le journal", async () => {
      await dansTransaction(async () => {
        await client.query(
          `update immeubles set compte_titulaire = 'Syndicat de test', compte_banque = 'Banque de test',
             compte_numero = 'SN08 0000 1111 2222' where id = $1`,
          [immeubleId],
        );
        await client.query("set local role authenticated");
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: coproprietaire }),
        ]);
        const lecture = await client.query(
          `select compte_numero, compte_modifie_le from immeubles where id = $1`,
          [immeubleId],
        );
        expect(lecture.rows[0].compte_numero).toBe("SN08 0000 1111 2222");
        expect(lecture.rows[0].compte_modifie_le).not.toBeNull();
        const modif = await essayer(client, `update immeubles set compte_numero = 'X' where id = $1`, [immeubleId]);
        expect(modif.lignes).toBe(0);
        const trace = await client.query(`select id from journal where entite_id = $1`, [immeubleId]);
        expect(trace.rowCount).toBe(0);
        await client.query("reset role");
      });
    });
  });

  describe("2. chaque modification laisse une trace", () => {
    for (const [champ, affectation, nouvelle] of MODIFICATIONS) {
      it(`${champ} : une ligne de journal, avec avant, après, auteur et date`, async () => {
        await dansTransaction(async () => {
          await agirComme(gestionnaire, async () => {
            const r = await essayer(client, `update immeubles set ${affectation} where id = $1`, [immeubleId]);
            expect(r.erreur).toBeNull();
            expect(r.lignes).toBe(1);
          });
          await client.query("reset role");

          const lignes = await journal();
          expect(lignes).toHaveLength(1);
          const ligne = lignes[0];
          expect(ligne.action).toBe("coordonnees_paiement_modifiees");
          expect(ligne.entite).toBe("immeubles");
          expect(ligne.entite_id).toBe(immeubleId);
          expect(ligne.organisation_id).toBe(organisationId);
          expect(ligne.acteur_id).toBe(gestionnaire);
          expect(ligne.acteur_libelle).toBe("gestionnaire.test@example.com");
          expect(ligne.avant[champ]).toBeNull();
          expect(ligne.apres[champ]).toBe(nouvelle);
          // Date : l'instant réel du changement, posé par la base (ni saisi, ni
          // antérieur au début de la transaction).
          const { rows } = await client.query(
            `select cree_le >= now() and cree_le <= clock_timestamp() as ok from journal where id = $1`,
            [ligne.id],
          );
          expect(rows[0].ok).toBe(true);
        });
      });
    }

    it("les moyens acceptés et les numéros marchands sont tracés comme les coordonnées bancaires", async () => {
      await dansTransaction(async () => {
        await agirComme(gestionnaire, async () => {
          await client.query(
            `update immeubles set moyens_paiement_acceptes = '{wave,virement}',
               numeros_marchands = '{"wave": "770000000"}' where id = $1`,
            [immeubleId],
          );
        });
        await client.query("reset role");
        const [ligne] = await journal("coordonnees_paiement_modifiees");
        expect(ligne.avant.moyens_paiement_acceptes).toEqual([]);
        expect(ligne.apres.moyens_paiement_acceptes).toEqual(["wave", "virement"]);
        expect(ligne.avant.numeros_marchands).toEqual({});
        expect(ligne.apres.numeros_marchands).toEqual({ wave: "770000000" });
      });
    });

    it("changer SEUL un numéro marchand est tracé", async () => {
      await dansTransaction(async () => {
        await client.query(
          `update immeubles set moyens_paiement_acceptes = '{orange_money}',
             numeros_marchands = '{"orange_money": "770000001"}' where id = $1`,
          [immeubleId],
        );
        const avantN = (await journal()).length;
        await agirComme(gestionnaire, async () => {
          await client.query(`update immeubles set numeros_marchands = '{"orange_money": "779999999"}' where id = $1`, [
            immeubleId,
          ]);
        });
        await client.query("reset role");
        const lignes = await journal();
        expect(lignes).toHaveLength(avantN + 1);
        expect(lignes.at(-1).avant.numeros_marchands).toEqual({ orange_money: "770000001" });
        expect(lignes.at(-1).apres.numeros_marchands).toEqual({ orange_money: "779999999" });
      });
    });

    it("plusieurs champs dans une seule requête : une seule ligne, l'état complet avant/après", async () => {
      await dansTransaction(async () => {
        await agirComme(proprietaireOrg, async () => {
          await client.query(
            `update immeubles set compte_titulaire = 'T', compte_banque = 'B', compte_numero = 'N',
               compte_bic = 'ABCDSNDA' where id = $1`,
            [immeubleId],
          );
        });
        await client.query("reset role");
        const lignes = await journal();
        expect(lignes).toHaveLength(1);
        expect(lignes[0].acteur_id).toBe(proprietaireOrg);
        expect(Object.keys(lignes[0].apres).sort()).toEqual([
          "compte_banque",
          "compte_bic",
          "compte_numero",
          "compte_titulaire",
          "moyens_paiement_acceptes",
          "numeros_marchands",
        ]);
      });
    });

    it("des modifications successives : une ligne chacune, chaînées (l'après de l'une est l'avant de la suivante)", async () => {
      await dansTransaction(async () => {
        await agirComme(gestionnaire, async () => {
          await client.query(`update immeubles set compte_numero = 'PREMIER' where id = $1`, [immeubleId]);
          await client.query(`update immeubles set compte_numero = 'SECOND' where id = $1`, [immeubleId]);
          await client.query(`update immeubles set compte_numero = 'TROISIEME' where id = $1`, [immeubleId]);
        });
        await client.query("reset role");
        const lignes = await journal("coordonnees_paiement_modifiees");
        expect(lignes).toHaveLength(3);
        expect(lignes.map((l) => l.apres.compte_numero)).toEqual(["PREMIER", "SECOND", "TROISIEME"]);
        expect(lignes[1].avant.compte_numero).toBe("PREMIER");
        expect(lignes[2].avant.compte_numero).toBe("SECOND");
      });
    });

    it("l'auteur est celui de la session, pas celui d'un autre membre du cabinet", async () => {
      await dansTransaction(async () => {
        await agirComme(proprietaireOrg, async () => {
          await client.query(`update immeubles set compte_banque = 'B' where id = $1`, [immeubleId]);
        });
        await client.query("reset role");
        const [ligne] = await journal();
        expect(ligne.acteur_id).toBe(proprietaireOrg);
        expect(ligne.acteur_libelle).toBe("proprietaire.test@example.com");
      });
    });

    it("une modification hors session (script, migration) est tracée quand même, sans auteur", async () => {
      await dansTransaction(async () => {
        await client.query(`update immeubles set compte_numero = 'HORS-SESSION' where id = $1`, [immeubleId]);
        const [ligne] = await journal();
        expect(ligne.acteur_id).toBeNull();
        expect(ligne.acteur_libelle).toBeNull();
        expect(ligne.apres.compte_numero).toBe("HORS-SESSION");
      });
    });

    describe("ce qui n'est PAS une modification des coordonnées", () => {
      it("une requête qui remet les mêmes valeurs ne laisse aucune trace", async () => {
        await dansTransaction(async () => {
          await client.query(`update immeubles set compte_titulaire = 'T', compte_numero = 'N' where id = $1`, [immeubleId]);
          const avantN = (await journal()).length;
          await agirComme(gestionnaire, async () => {
            await client.query(`update immeubles set compte_titulaire = 'T', compte_numero = 'N' where id = $1`, [immeubleId]);
          });
          await client.query("reset role");
          expect(await journal()).toHaveLength(avantN);
        });
      });

      it("des espaces en trop, ou un champ vide remplacé par un champ vide, ne sont pas une modification", async () => {
        await dansTransaction(async () => {
          await client.query(`update immeubles set compte_titulaire = 'ACME' where id = $1`, [immeubleId]);
          const avantN = (await journal()).length;
          await client.query(`update immeubles set compte_titulaire = '  ACME  ' where id = $1`, [immeubleId]);
          await client.query(`update immeubles set compte_banque = '' where id = $1`, [immeubleId]);
          expect(await journal()).toHaveLength(avantN);
        });
      });

      it("modifier un autre champ de l'immeuble (nom, ville) ne trace rien", async () => {
        await dansTransaction(async () => {
          await agirComme(gestionnaire, async () => {
            await client.query(`update immeubles set nom = 'Autre nom', ville = 'Dakar' where id = $1`, [immeubleId]);
          });
          await client.query("reset role");
          expect(await journal()).toHaveLength(0);
          expect((await immeuble()).compte_modifie_le).toBeNull();
        });
      });
    });

    describe("le format de la référence : tracé aussi, sous une autre action", () => {
      it("le changement de format est tracé, et n'est pas une modification des coordonnées", async () => {
        await dansTransaction(async () => {
          await agirComme(gestionnaire, async () => {
            await client.query(`update immeubles set format_reference_appel = 'TOUR-{annee}-{seq}' where id = $1`, [
              immeubleId,
            ]);
          });
          await client.query("reset role");
          expect(await journal("coordonnees_paiement_modifiees")).toHaveLength(0);
          const [ligne] = await journal("format_reference_modifie");
          expect(ligne.avant.format_reference_appel).toBe("{code}-{annee}{periode}-{seq}");
          expect(ligne.apres.format_reference_appel).toBe("TOUR-{annee}-{seq}");
          expect(ligne.acteur_id).toBe(gestionnaire);
          expect((await immeuble()).compte_modifie_le).toBeNull();
        });
      });

      it("le changement de code est tracé", async () => {
        await dansTransaction(async () => {
          await client.query(`update immeubles set code_reference = 'TST' where id = $1`, [immeubleId]);
          const [ligne] = await journal("format_reference_modifie");
          expect(ligne.avant.code_reference).toBeNull();
          expect(ligne.apres.code_reference).toBe("TST");
        });
      });
    });

    describe("création d'un immeuble", () => {
      it("un immeuble créé avec des coordonnées est tracé (avant nul)", async () => {
        await dansTransaction(async () => {
          const r = await client.query<{ id: string }>(
            `insert into immeubles (organisation_id, nom, compte_numero) values ($1, 'Avec compte', 'SN00 TEST')
             returning id`,
            [organisationId],
          );
          const { rows } = await client.query(
            `select avant, apres from journal where entite_id = $1`,
            [r.rows[0]!.id],
          );
          expect(rows).toHaveLength(1);
          expect(rows[0].avant).toBeNull();
          expect(rows[0].apres.compte_numero).toBe("SN00 TEST");
        });
      });

      it("un immeuble créé sans coordonnées ne laisse pas de trace vide", async () => {
        await dansTransaction(async () => {
          const r = await client.query<{ id: string }>(
            `insert into immeubles (organisation_id, nom) values ($1, 'Sans compte') returning id`,
            [organisationId],
          );
          const { rows } = await client.query(`select 1 from journal where entite_id = $1`, [r.rows[0]!.id]);
          expect(rows).toHaveLength(0);
        });
      });
    });

    describe("la trace est fiable", () => {
      it("un utilisateur ne peut ni écrire, ni modifier, ni supprimer dans le journal", async () => {
        for (const [nom, utilisateurTest] of [
          ["gestionnaire", gestionnaire],
          ["proprietaire_org", proprietaireOrg],
          ["lecteur", lecteur],
        ] as const) {
          await dansTransaction(async () => {
            await client.query(`update immeubles set compte_numero = 'N' where id = $1`, [immeubleId]);
            await client.query("set local role authenticated");
            await client.query("select set_config('request.jwt.claims', $1, true)", [
              JSON.stringify({ sub: utilisateurTest }),
            ]);

            const ecriture = await essayer(
              client,
              `insert into journal (organisation_id, entite, action) values ($1, 'immeubles', 'falsifiee')`,
              [organisationId],
            );
            expect(ecriture.erreur, nom).toMatch(/row-level security/);

            const modif = await essayer(client, `update journal set apres = '{}'::jsonb where entite_id = $1`, [immeubleId]);
            expect(modif.lignes, nom).toBe(0);
            const suppression = await essayer(client, `delete from journal where entite_id = $1`, [immeubleId]);
            expect(suppression.lignes, nom).toBe(0);

            await client.query("reset role");
            expect(await journal(), nom).toHaveLength(1);
          });
        }
      });

      it("une modification qui échoue (contrainte) ne laisse aucune trace", async () => {
        await dansTransaction(async () => {
          await agirComme(gestionnaire, async () => {
            const r = await essayer(
              client,
              `update immeubles set compte_numero = 'N', compte_bic = 'pas-un-bic' where id = $1`,
              [immeubleId],
            );
            expect(r.erreur).toMatch(/immeubles_bic_format/);
          });
          await client.query("reset role");
          expect(await journal()).toHaveLength(0);
          expect((await immeuble()).compte_numero).toBeNull();
        });
      });

      it("supprimer le compte de l'auteur garde la trace, avec son libellé, sans le lien", async () => {
        await dansTransaction(async () => {
          await agirComme(gestionnaire, async () => {
            await client.query(`update immeubles set compte_numero = 'N' where id = $1`, [immeubleId]);
          });
          await client.query("reset role");
          await client.query(`delete from auth.users where id = $1`, [gestionnaire]);
          const [ligne] = await journal();
          expect(ligne.acteur_id).toBeNull();
          expect(ligne.acteur_libelle).toBe("gestionnaire.test@example.com");
        });
      });
    });
  });

  describe("3. la date de dernière modification — posée par la base, jamais saisie", () => {
    it("null tant que les coordonnées n'ont jamais été renseignées", async () => {
      expect((await immeuble()).compte_modifie_le).toBeNull();
    });

    it("posée à l'instant de la modification d'une coordonnée", async () => {
      await dansTransaction(async () => {
        await agirComme(gestionnaire, async () => {
          await client.query(`update immeubles set compte_numero = 'N' where id = $1`, [immeubleId]);
        });
        await client.query("reset role");
        const { rows } = await client.query(`select compte_modifie_le >= now() and compte_modifie_le <= clock_timestamp() as ok from immeubles where id = $1`, [immeubleId]);
        expect(rows[0].ok).toBe(true);
      });
    });

    it("visible du copropriétaire, qui repère ainsi un changement de compte", async () => {
      await dansTransaction(async () => {
        await client.query(`update immeubles set compte_numero = 'N' where id = $1`, [immeubleId]);
        await client.query("set local role authenticated");
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: coproprietaire }),
        ]);
        const { rows } = await client.query(`select compte_modifie_le from immeubles where id = $1`, [immeubleId]);
        expect(rows[0].compte_modifie_le).not.toBeNull();
        await client.query("reset role");
      });
    });

    it("inchangée par une modification qui ne touche pas aux coordonnées", async () => {
      await dansTransaction(async () => {
        await client.query(`update immeubles set compte_numero = 'N' where id = $1`, [immeubleId]);
        await client.query(`update immeubles set compte_modifie_le = '2000-01-01' where id = $1`, [immeubleId]);
        const avant = (await immeuble()).compte_modifie_le;
        await client.query(`update immeubles set nom = 'Autre' where id = $1`, [immeubleId]);
        expect((await immeuble()).compte_modifie_le).toEqual(avant);
      });
    });

    it("ne se falsifie pas : une date antidatée est écrasée", async () => {
      await dansTransaction(async () => {
        await agirComme(gestionnaire, async () => {
          // Sans changement de coordonnée : la date reste nulle.
          await client.query(`update immeubles set compte_modifie_le = '2000-01-01' where id = $1`, [immeubleId]);
        });
        await client.query("reset role");
        expect((await immeuble()).compte_modifie_le).toBeNull();

        await agirComme(gestionnaire, async () => {
          // Avec un changement de coordonnée : l'instant réel, pas la date fournie.
          await client.query(
            `update immeubles set compte_numero = 'N', compte_modifie_le = '2000-01-01' where id = $1`,
            [immeubleId],
          );
        });
        await client.query("reset role");
        const { rows } = await client.query(`select compte_modifie_le >= now() and compte_modifie_le <= clock_timestamp() as ok from immeubles where id = $1`, [immeubleId]);
        expect(rows[0].ok).toBe(true);
      });
    });

    it("effacer une coordonnée est une modification : la date avance", async () => {
      await dansTransaction(async () => {
        await client.query(`update immeubles set compte_numero = 'N' where id = $1`, [immeubleId]);
        await client.query(`update immeubles set compte_modifie_le = '2000-01-01' where id = $1`, [immeubleId]);
        await client.query(`update immeubles set compte_numero = null where id = $1`, [immeubleId]);
        const { rows } = await client.query(`select compte_modifie_le >= now() and compte_modifie_le <= clock_timestamp() as ok from immeubles where id = $1`, [immeubleId]);
        expect(rows[0].ok).toBe(true);
        expect(await journal("coordonnees_paiement_modifiees")).toHaveLength(2);
      });
    });
  });

  describe("4. contraintes de cohérence", () => {
    const refuse = async (sql: string, motif: RegExp) =>
      dansTransaction(async () => {
        const r = await essayer(client, sql, [immeubleId]);
        expect(r.erreur, sql).toMatch(motif);
      });
    const accepte = async (sql: string) =>
      dansTransaction(async () => {
        const r = await essayer(client, sql, [immeubleId]);
        expect(r.erreur, sql).toBeNull();
      });

    it("les virements internationaux exigent un code SWIFT", async () => {
      await refuse(`update immeubles set moyens_paiement_acceptes = '{virement_international}' where id = $1`, /immeubles_swift_requis/);
      await refuse(
        `update immeubles set moyens_paiement_acceptes = '{virement_international}', compte_bic = '   ' where id = $1`,
        /immeubles_swift_requis|immeubles_bic_format/,
      );
      await accepte(
        `update immeubles set moyens_paiement_acceptes = '{virement_international}', compte_bic = 'ABCDSNDA' where id = $1`,
      );
    });

    it("le code SWIFT a 8 ou 11 caractères alphanumériques en capitales", async () => {
      for (const invalide of ["abc", "ABCDEFG", "ABCDEFGHI", "ABCDEFGHIJ", "ABCD SNDA", "abcdsnda", "ABCDSND!"]) {
        await refuse(`update immeubles set compte_bic = '${invalide}' where id = $1`, /immeubles_bic_format/);
      }
      for (const valide of ["ABCDSNDA", "ABCDSNDAXXX", "ABCD1234"]) {
        await accepte(`update immeubles set compte_bic = '${valide}' where id = $1`);
      }
    });

    it("un numéro marchand n'existe que pour un moyen mobile accepté", async () => {
      await accepte(
        `update immeubles set moyens_paiement_acceptes = '{wave,orange_money}',
           numeros_marchands = '{"wave": "770000000", "orange_money": "780000000"}' where id = $1`,
      );
      // Moyen non accepté :
      await refuse(`update immeubles set numeros_marchands = '{"wave": "770000000"}' where id = $1`, /numeros_marchands_valides/);
      // Moyen qui ne porte pas de numéro marchand :
      await refuse(
        `update immeubles set moyens_paiement_acceptes = '{virement}', numeros_marchands = '{"virement": "1"}' where id = $1`,
        /numeros_marchands_valides/,
      );
      // Clé inconnue, valeur vide ou d'un autre type, structure qui n'est pas un objet :
      await refuse(`update immeubles set numeros_marchands = '{"bitcoin": "1"}' where id = $1`, /numeros_marchands_valides|invalid input/);
      await refuse(
        `update immeubles set moyens_paiement_acceptes = '{wave}', numeros_marchands = '{"wave": ""}' where id = $1`,
        /numeros_marchands_valides/,
      );
      await refuse(
        `update immeubles set moyens_paiement_acceptes = '{wave}', numeros_marchands = '{"wave": 770000000}' where id = $1`,
        /numeros_marchands_valides/,
      );
      await refuse(`update immeubles set numeros_marchands = '[]'::jsonb where id = $1`, /numeros_marchands_valides/);
    });

    it("décocher un moyen sans retirer son numéro marchand est refusé (pas de donnée orpheline)", async () => {
      await dansTransaction(async () => {
        await client.query(
          `update immeubles set moyens_paiement_acceptes = '{wave}', numeros_marchands = '{"wave": "770000000"}' where id = $1`,
          [immeubleId],
        );
        const r = await essayer(client, `update immeubles set moyens_paiement_acceptes = '{}' where id = $1`, [immeubleId]);
        expect(r.erreur).toMatch(/numeros_marchands_valides/);
      });
    });

    it("le code de référence est unique par cabinet, pas entre cabinets", async () => {
      await dansTransaction(async () => {
        await client.query(`update immeubles set code_reference = 'DUP' where id = $1`, [immeubleId]);
        const meme = await essayer(
          client,
          `insert into immeubles (organisation_id, nom, code_reference) values ($1, 'Second', 'DUP')`,
          [organisationId],
        );
        expect(meme.erreur).toMatch(/immeubles_code_reference_unique/);
        const autre = await essayer(client, `update immeubles set code_reference = 'DUP' where id = $1`, [autreImmeubleId]);
        expect(autre.erreur).toBeNull();
      });
    });
  });

  describe("5. le miroir TypeScript dit la même chose que la base", () => {
    it("codePeriode == app.code_periode, pour les quatre périodicités et les douze mois", async () => {
      const periodicites: Periodicite[] = ["mensuel", "trimestriel", "semestriel", "annuel"];
      for (const periodicite of periodicites) {
        for (let mois = 1; mois <= 12; mois += 1) {
          const { rows } = await client.query<{ code: string }>(
            `select app.code_periode($1::periodicite, make_date(2026, $2, 1)) as code`,
            [periodicite, mois],
          );
          expect(codePeriode(periodicite, mois), `${periodicite} ${mois}`).toBe(rows[0]!.code);
        }
      }
    });

    it("formatReferenceValide et codeReferenceValide acceptent et refusent comme la base", async () => {
      const formats = [
        "{code}-{annee}{periode}-{seq}",
        "TOUR-{annee}-{seq}",
        "{seq}",
        "{code}_{seq}",
        "{code}-{annee}",
        "{code} {seq}",
        "{code}-{seq}-{uuid}",
        "{seq}/{annee}",
        "",
        "{code}-{seq}!",
        "abc{seq}déf",
      ];
      for (const format of formats) {
        await dansTransaction(async () => {
          const r = await essayer(client, `update immeubles set format_reference_appel = $2 where id = $1`, [
            immeubleId,
            format,
          ]);
          expect(formatReferenceValide(format), `format « ${format} »`).toBe(r.erreur === null);
        });
      }

      const codes = ["MT", "A", "ABCDEFGH", "ABCDEFGHI", "mt", "M T", "M-T", "", "M1", "É"];
      for (const code of codes) {
        await dansTransaction(async () => {
          const r = await essayer(client, `update immeubles set code_reference = $2 where id = $1`, [immeubleId, code]);
          expect(codeReferenceValide(code), `code « ${code} »`).toBe(r.erreur === null);
        });
      }
    });
  });
});
