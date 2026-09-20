import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";
import { creerSessions } from "./aides";
import {
  appelsPayables,
  calculerTotaux,
  composerMouvements,
  type AppelBrut,
  type PaiementBrut,
} from "@/lib/releve/calcul";

// Enregistrement manuel des paiements (20260920020000_paiements_manuels.sql) :
// le statut de l'appel suit les paiements, un paiement ne se modifie jamais, une
// annulation est une écriture inverse, tout est tracé dans journal.
//
// Une seule transaction pour tout le fichier, annulée à la fin : le jeu de dev ne
// garde rien. Chaque test tourne dans un point de sauvegarde annulé.

describe("paiements manuels — base de données", () => {
  let client: Client;
  let sessions: ReturnType<typeof creerSessions>;
  let immeubleId: string;
  let organisationId: string;
  let periodeId: string;
  let gestionnaire: string;
  let lecteur: string;
  let etranger: string;

  const dansSauvegarde = async (corps: () => Promise<void>) => {
    await client.query("savepoint test");
    try {
      await corps();
    } finally {
      await client.query("rollback to savepoint test");
    }
  };

  // Le code SQLSTATE et le message d'une requête qui doit échouer (ou null).
  const tenter = async (sql: string, params: unknown[] = []) => {
    await client.query("savepoint tentative");
    try {
      await client.query(sql, params);
      await client.query("release savepoint tentative");
      return null;
    } catch (e) {
      await client.query("rollback to savepoint tentative");
      const err = e as { code?: string; message: string };
      return { code: err.code ?? "", message: err.message };
    }
  };

  const appelsDe = async (statut: string) =>
    (await client.query(`select * from appels where periode_id = $1 and statut = $2 order by numero`, [periodeId, statut])).rows;
  const ligne = async (id: string) => (await client.query(`select * from appels where id = $1`, [id])).rows[0];
  const emettre = (id: string) => client.query(`update appels set statut = 'emis' where id = $1`, [id]);
  // Un appel émis, prêt à recevoir des paiements.
  const appelEmis = async () => {
    const b = (await appelsDe("brouillon"))[0]!;
    await emettre(b.id);
    return ligne(b.id);
  };
  const payer = async (appel: string, montant: number | string, moyen = "virement", ref: string | null = null) =>
    (await client.query(`select public.enregistrer_paiement($1, $2, $3, current_date, $4) as id`, [appel, montant, moyen, ref])).rows[0].id as string;
  const annuler = async (paiement: string, motif = "Saisie erronée") =>
    (await client.query(`select public.annuler_paiement($1, $2) as id`, [paiement, motif])).rows[0].id as string;
  const paiement = async (id: string) => (await client.query(`select * from paiements where id = $1`, [id])).rows[0];

  beforeAll(async () => {
    client = await connecter();
    await client.query("begin");
    sessions = creerSessions(client, { dejaEnTransaction: true });

    const { rows } = await client.query<{ id: string; organisation_id: string }>(
      `select id, organisation_id from immeubles where nom = 'Mamelles Tower'`,
    );
    immeubleId = rows[0]!.id;
    organisationId = rows[0]!.organisation_id;

    const utilisateur = async (email: string, organisation: string, role: string) => {
      const u = await client.query<{ id: string }>(
        `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
        [email],
      );
      await client.query(`insert into membres (organisation_id, user_id, role) values ($1, $2, $3)`, [
        organisation,
        u.rows[0]!.id,
        role,
      ]);
      return u.rows[0]!.id;
    };
    gestionnaire = await utilisateur("paiements.gestionnaire@example.com", organisationId, "gestionnaire");
    lecteur = await utilisateur("paiements.lecteur@example.com", organisationId, "lecteur");
    const autre = await client.query<{ id: string }>(
      `insert into organisations (nom, slug) values ('Cabinet étranger paiements', 'cabinet-etranger-paiements') returning id`,
    );
    etranger = await utilisateur("paiements.etranger@example.com", autre.rows[0]!.id, "proprietaire_org");

    const postes = await client.query<{ id: string }>(
      `select pc.id from postes_charges pc join cles_repartition cr on cr.id = pc.cle_repartition_id
       where pc.immeuble_id = $1 and cr.code = 'tantiemes' and pc.categorie = 'general' order by pc.ordre limit 3`,
      [immeubleId],
    );
    const exercice = await client.query<{ id: string }>(
      `insert into exercices (immeuble_id, libelle, date_debut, date_fin)
       values ($1, 'Exercice test paiements', '2031-01-01', '2031-12-31') returning id`,
      [immeubleId],
    );
    const periode = await client.query<{ id: string }>(
      `insert into periodes (exercice_id, libelle, date_debut, date_fin, date_echeance)
       values ($1, 'Période test paiements', '2031-01-01', '2031-03-31', '2031-01-01') returning id`,
      [exercice.rows[0]!.id],
    );
    periodeId = periode.rows[0]!.id;
    for (const [i, poste] of postes.rows.entries()) {
      await client.query(`insert into budget_lignes (periode_id, poste_charge_id, montant) values ($1, $2, $3)`, [
        periodeId,
        poste.id,
        [450000, 275500, 90000][i],
      ]);
    }
    await client.query(
      `update immeubles set compte_titulaire = 'Syndicat test', compte_banque = 'Banque test',
         compte_numero = 'SN08 TEST 1111 2222', moyens_paiement_acceptes = '{wave,virement}',
         numeros_marchands = '{"wave": "77 000 00 00"}' where id = $1`,
      [immeubleId],
    );
    await client.query(`select app.generer_appels($1)`, [periodeId]);
  });

  afterAll(async () => {
    await client.query("rollback");
    await client.end();
  });

  describe("le statut de l'appel suit les paiements", () => {
    it("émis → partiel → soldé, avec le moyen, l'appel et le destinataire de l'appel", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        expect(a.statut).toBe("emis");
        const total = Number(a.montant_total);
        const p1 = await payer(a.id, 1000, "wave", "TX-42");
        expect((await ligne(a.id)).statut).toBe("partiel");
        const ligne1 = await paiement(p1);
        expect(ligne1).toMatchObject({
          appel_id: a.id,
          proprietaire_id: a.proprietaire_id,
          moyen: "wave",
          reference_externe: "TX-42",
          statut: "confirme",
          annule_paiement_id: null,
        });
        expect(Number(ligne1.montant)).toBe(1000);
        await payer(a.id, total - 1000, "virement");
        expect((await ligne(a.id)).statut).toBe("solde");
      });
    });

    it("les cinq moyens saisis à la main sont acceptés ; le chèque ne l'est pas", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        for (const moyen of ["virement", "virement_international", "especes", "wave", "orange_money"]) {
          await payer(a.id, 1, moyen);
        }
        const refus = await tenter(`select public.enregistrer_paiement($1, 1, 'cheque', current_date)`, [a.id]);
        expect(refus?.code).toBe("PA003");
      });
    });

    it("un paiement qui dépasse le reste dû est refusé ; le reste exact est accepté", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const total = Number(a.montant_total);
        await payer(a.id, total - 10);
        expect((await tenter(`select public.enregistrer_paiement($1, 11, 'virement', current_date)`, [a.id]))?.code).toBe("PA002");
        expect((await ligne(a.id)).statut).toBe("partiel");
        await payer(a.id, 10);
        expect((await ligne(a.id)).statut).toBe("solde");
        // Soldé : plus rien n'est dû.
        expect((await tenter(`select public.enregistrer_paiement($1, 1, 'virement', current_date)`, [a.id]))?.code).toBe("PA002");
      });
    });

    it("pas de paiement sur un brouillon, ni sur un appel annulé", async () => {
      await dansSauvegarde(async () => {
        const [brouillon, autre] = await appelsDe("brouillon");
        expect((await tenter(`select public.enregistrer_paiement($1, 1, 'virement', current_date)`, [brouillon!.id]))?.code).toBe("PA001");
        await emettre(autre!.id);
        await client.query(`update appels set statut = 'annule' where id = $1`, [autre!.id]);
        expect((await tenter(`select public.enregistrer_paiement($1, 1, 'virement', current_date)`, [autre!.id]))?.code).toBe("PA001");
      });
    });

    it("montant invalide, date dans le futur, appel introuvable", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        for (const montant of ["0", "-5", "10.001"]) {
          const r = await tenter(`select public.enregistrer_paiement($1, $2, 'virement', current_date)`, [a.id, montant]);
          expect(r?.code, montant).toBe("PA004");
        }
        expect((await tenter(`select public.enregistrer_paiement($1, 1, 'virement', current_date + 1)`, [a.id]))?.code).toBe("PA007");
        expect(
          (await tenter(`select public.enregistrer_paiement(gen_random_uuid(), 1, 'virement', current_date)`))?.code,
        ).toBe("23503");
      });
    });

    it("l'insertion directe est validée elle aussi : mauvais destinataire refusé", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const autre = (await client.query(`select id from proprietaires where id <> $1 and immeuble_id = $2 limit 1`, [a.proprietaire_id, immeubleId])).rows[0];
        const r = await tenter(
          `insert into paiements (appel_id, proprietaire_id, montant, moyen) values ($1, $2, 1, 'virement')`,
          [a.id, autre.id],
        );
        expect(r?.code).toBe("PA009");
      });
    });
  });

  describe("qui peut enregistrer", () => {
    it("le gestionnaire oui ; le lecteur et un autre cabinet non, avec le même message qu'un appel introuvable", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const sql = `select public.enregistrer_paiement($1, 1, 'virement', current_date)`;
        await sessions.enSession(gestionnaire, async () => {
          expect((await tenter(sql, [a.id]))).toBeNull();
        });
        const refus: string[] = [];
        for (const [nom, utilisateur, appel] of [
          ["lecteur", lecteur, a.id],
          ["autre cabinet", etranger, a.id],
          ["appel inexistant", gestionnaire === lecteur ? gestionnaire : etranger, "00000000-0000-0000-0000-000000000000"],
        ] as const) {
          await sessions.enSession(utilisateur, async () => {
            const r = await tenter(sql, [appel]);
            expect(r?.code, nom).toBe("42501");
            refus.push(r!.message);
          });
        }
        // L'existence d'un appel d'un autre cabinet n'est pas révélée.
        expect(new Set(refus).size).toBe(1);
      });
    });

    it("aucun utilisateur n'écrit directement dans paiements : ni insertion, ni modification, ni suppression", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const p = await payer(a.id, 1);
        await sessions.enSession(gestionnaire, async () => {
          expect((await tenter(`insert into paiements (appel_id, proprietaire_id, montant, moyen) values ($1, $2, 1, 'virement')`, [a.id, a.proprietaire_id]))?.message).toMatch(/permission denied/);
          expect((await tenter(`update paiements set montant = 1 where id = $1`, [p]))?.message).toMatch(/permission denied/);
          expect((await tenter(`delete from paiements where id = $1`, [p]))?.message).toMatch(/permission denied/);
        });
      });
    });

    it("un lecteur lit les paiements, sans pouvoir en écrire", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        await payer(a.id, 5);
        await sessions.enSession(lecteur, async () => {
          const { rows } = await client.query(`select id from paiements where appel_id = $1`, [a.id]);
          expect(rows).toHaveLength(1);
        });
      });
    });

    it("un autre cabinet ne voit aucun paiement", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        await payer(a.id, 5);
        await sessions.enSession(etranger, async () => {
          const { rows } = await client.query(`select id from paiements where appel_id = $1`, [a.id]);
          expect(rows).toHaveLength(0);
        });
      });
    });
  });

  describe("un paiement enregistré ne se modifie jamais : il s'annule par une écriture inverse", () => {
    it("modification et suppression refusées, même pour le propriétaire de la base", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const p = await payer(a.id, 100);
        for (const sql of [
          `update paiements set montant = 1 where id = $1`,
          `update paiements set moyen = 'especes' where id = $1`,
          `update paiements set statut = 'echoue' where id = $1`,
          `update paiements set appel_id = null where id = $1`,
          `delete from paiements where id = $1`,
        ]) {
          const r = await tenter(sql, [p]);
          expect(r?.code, sql).toBe("23514");
          expect(r?.message, sql).toMatch(/écriture inverse/);
        }
        expect(Number((await paiement(p)).montant)).toBe(100);
      });
    });

    it("annuler ajoute une ligne négative liée au paiement, avec le motif ; l'original n'est pas touché ; le statut recule", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const p = await payer(a.id, 1000, "especes", "REÇU-9");
        const avant = await paiement(p);
        expect((await ligne(a.id)).statut).toBe("partiel");

        const inverse = await annuler(p, "Saisi sur le mauvais appel");
        const ecriture = await paiement(inverse);
        expect(ecriture).toMatchObject({
          annule_paiement_id: p,
          appel_id: a.id,
          proprietaire_id: a.proprietaire_id,
          moyen: "especes",
          motif: "Saisi sur le mauvais appel",
          statut: "confirme",
        });
        expect(Number(ecriture.montant)).toBe(-1000);
        expect(await paiement(p)).toEqual(avant);
        expect((await ligne(a.id)).statut).toBe("emis");
      });
    });

    it("annuler un paiement d'un appel soldé le ramène à partiel", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const total = Number(a.montant_total);
        const p1 = await payer(a.id, 1000);
        await payer(a.id, total - 1000);
        expect((await ligne(a.id)).statut).toBe("solde");
        await annuler(p1);
        expect((await ligne(a.id)).statut).toBe("partiel");
        // Le reste dû est de nouveau de 1000 : on peut le ressaisir, pas plus.
        expect((await tenter(`select public.enregistrer_paiement($1, 1001, 'virement', current_date)`, [a.id]))?.code).toBe("PA002");
        await payer(a.id, 1000);
        expect((await ligne(a.id)).statut).toBe("solde");
      });
    });

    it("un paiement ne s'annule qu'une fois ; une annulation ne s'annule pas ; le motif est obligatoire", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const p = await payer(a.id, 50);
        expect((await tenter(`select public.annuler_paiement($1, '   ')`, [p]))?.code).toBe("PA006");
        expect((await tenter(`select public.annuler_paiement($1, null)`, [p]))?.code).toBe("PA006");
        const inverse = await annuler(p);
        expect((await tenter(`select public.annuler_paiement($1, 'encore')`, [p]))?.code).toBe("PA005");
        expect((await tenter(`select public.annuler_paiement($1, 'annuler l''annulation')`, [inverse]))?.code).toBe("PA008");
        expect((await tenter(`select public.annuler_paiement(gen_random_uuid(), 'x')`))?.code).toBe("23503");
      });
    });

    it("une écriture inverse insérée à la main doit reprendre exactement le paiement, avec un motif", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const p = await payer(a.id, 100);
        const inverse = (montant: number, motif: string | null) =>
          tenter(
            `insert into paiements (appel_id, proprietaire_id, montant, moyen, annule_paiement_id, motif)
             values ($1, $2, $3, 'virement', $4, $5)`,
            [a.id, a.proprietaire_id, montant, p, motif],
          );
        expect((await inverse(-99, "x"))?.code).toBe("PA008");
        expect((await inverse(-100, null))?.message).toMatch(/paiements_motif_annulation/);
        // Positif : refusé par la validation (avant même la contrainte de signe).
        expect((await inverse(100, "x"))?.message).toMatch(/reprend exactement|paiements_sens_montant/);
        expect(await inverse(-100, "x")).toBeNull();
      });
    });

    it("un paiement positif ne peut pas se donner pour une annulation, ni l'inverse", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        expect((await tenter(`insert into paiements (appel_id, proprietaire_id, montant, moyen) values ($1, $2, -5, 'virement')`, [a.id, a.proprietaire_id]))?.message).toMatch(/paiements_sens_montant/);
      });
    });
  });

  describe("le statut d'un appel ne se pose pas à la main", () => {
    it("ni soldé sans paiements, ni partiel depuis un brouillon, ni soldé alors que le reste n'est pas payé", async () => {
      await dansSauvegarde(async () => {
        const [brouillon] = await appelsDe("brouillon");
        expect((await tenter(`update appels set statut = 'partiel' where id = $1`, [brouillon!.id]))?.message).toMatch(/statut émis/);
        const a = await appelEmis();
        expect((await tenter(`update appels set statut = 'solde' where id = $1`, [a.id]))?.message).toMatch(/suit ses paiements/);
        await payer(a.id, 10);
        expect((await tenter(`update appels set statut = 'solde' where id = $1`, [a.id]))?.message).toMatch(/suit ses paiements/);
        expect((await tenter(`update appels set statut = 'emis' where id = $1`, [a.id]))?.message).toMatch(/suit ses paiements/);
        expect((await ligne(a.id)).statut).toBe("partiel");
      });
    });

    it("un appel qui porte des paiements ne s'annule pas ; une fois ses paiements annulés, oui", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const p = await payer(a.id, 10);
        expect((await tenter(`update appels set statut = 'annule' where id = $1`, [a.id]))?.message).toMatch(/annulez d'abord ses paiements/);
        await annuler(p);
        expect(await tenter(`update appels set statut = 'annule' where id = $1`, [a.id])).toBeNull();
        expect((await ligne(a.id)).statut).toBe("annule");
        // Aucun paiement nouveau sur un appel annulé.
        expect((await tenter(`select public.enregistrer_paiement($1, 1, 'virement', current_date)`, [a.id]))?.code).toBe("PA001");
      });
    });
  });

  describe("chaque paiement et chaque annulation laissent une trace dans journal", () => {
    const traces = async (entiteId: string) =>
      (await client.query(`select * from journal where entite = 'paiements' and entite_id = $1 order by cree_le`, [entiteId])).rows;

    it("un paiement saisi par un gestionnaire : qui, quoi, combien", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        let id = "";
        await sessions.enSession(gestionnaire, async () => {
          id = (await client.query(`select public.enregistrer_paiement($1, 2500, 'orange_money', current_date, 'OM-1') as id`, [a.id])).rows[0].id;
        });
        const [trace, ...reste] = await traces(id);
        expect(reste).toHaveLength(0);
        expect(trace).toMatchObject({
          organisation_id: organisationId,
          acteur_id: gestionnaire,
          acteur_libelle: "paiements.gestionnaire@example.com",
          action: "paiement_enregistre",
          avant: null,
        });
        expect(trace.apres).toMatchObject({ id, appel_id: a.id, moyen: "orange_money", reference_externe: "OM-1", statut: "confirme" });
        expect(Number(trace.apres.montant)).toBe(2500);
        // Qui a saisi est aussi sur le paiement lui-même.
        expect(await paiement(id)).toMatchObject({ saisi_par: gestionnaire, saisi_par_libelle: "paiements.gestionnaire@example.com" });
      });
    });

    it("une annulation : la trace garde le paiement annulé en `avant`, et le motif", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const p = await payer(a.id, 700, "especes");
        let inverse = "";
        await sessions.enSession(gestionnaire, async () => {
          inverse = (await client.query(`select public.annuler_paiement($1, 'Erreur de caisse') as id`, [p])).rows[0].id;
        });
        const [trace] = await traces(inverse);
        expect(trace).toMatchObject({ action: "paiement_annule", acteur_id: gestionnaire });
        expect(trace.avant).toMatchObject({ id: p, moyen: "especes" });
        expect(Number(trace.avant.montant)).toBe(700);
        expect(trace.apres).toMatchObject({ annule_paiement_id: p, motif: "Erreur de caisse" });
        expect(Number(trace.apres.montant)).toBe(-700);
        expect(await traces(p)).toHaveLength(1); // le paiement d'origine garde sa propre trace
      });
    });

    it("un paiement inséré en SQL direct est tracé aussi (déclencheur, pas application)", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const { rows } = await client.query(
          `insert into paiements (appel_id, proprietaire_id, montant, moyen) values ($1, $2, 5, 'virement') returning id`,
          [a.id, a.proprietaire_id],
        );
        expect(await traces(rows[0].id)).toHaveLength(1);
      });
    });

    it("un paiement refusé ne laisse aucune trace", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const avant = (await client.query(`select count(*)::int n from journal where entite = 'paiements'`)).rows[0].n;
        await tenter(`select public.enregistrer_paiement($1, 999999999, 'virement', current_date)`, [a.id]);
        const apres = (await client.query(`select count(*)::int n from journal where entite = 'paiements'`)).rows[0].n;
        expect(apres).toBe(avant);
      });
    });

    it("la trace subsiste quand le compte de l'auteur est supprimé ; le paiement, lui, reste immuable", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        let id = "";
        await sessions.enSession(gestionnaire, async () => {
          id = (await client.query(`select public.enregistrer_paiement($1, 10, 'virement', current_date) as id`, [a.id])).rows[0].id;
        });
        await client.query(`delete from membres where user_id = $1`, [gestionnaire]);
        await client.query(`delete from auth.users where id = $1`, [gestionnaire]);
        expect(await paiement(id)).toMatchObject({ saisi_par: null, saisi_par_libelle: "paiements.gestionnaire@example.com" });
        expect((await traces(id))[0]).toMatchObject({ acteur_id: null, acteur_libelle: "paiements.gestionnaire@example.com" });
      });
    });
  });

  describe("le relevé : seuls les appels émis, partiels ou soldés comptent", () => {
    const brutsDe = async (proprietaireId: string) => {
      const appels = (
        await client.query(
          `select id, reference, montant_total::float8 as montant_total, statut, date_echeance::text as date_echeance, periode_id
           from appels where proprietaire_id = $1`,
          [proprietaireId],
        )
      ).rows as AppelBrut[];
      const paiements = (
        await client.query(
          `select id, appel_id, montant::float8 as montant, moyen, statut, date_paiement::text as date_paiement,
                  reference_externe, annule_paiement_id, motif from paiements where proprietaire_id = $1`,
          [proprietaireId],
        )
      ).rows as PaiementBrut[];
      return { appels, paiements, totaux: calculerTotaux(appels, paiements) };
    };

    it("un brouillon ne compte pas", async () => {
      await dansSauvegarde(async () => {
        const [b] = await appelsDe("brouillon");
        const { totaux, appels } = await brutsDe(b!.proprietaire_id);
        expect(appels.some((a) => a.statut === "brouillon")).toBe(true);
        expect(totaux.totalAppele).toBe(0);
      });
    });

    it("annuler puis réémettre un appel ne double pas le total appelé", async () => {
      await dansSauvegarde(async () => {
        const premier = await appelEmis();
        const montant = Number(premier.montant_total);
        expect((await brutsDe(premier.proprietaire_id)).totaux.totalAppele).toBe(montant);

        // Annulé : il sort du total.
        await client.query(`update appels set statut = 'annule' where id = $1`, [premier.id]);
        expect((await brutsDe(premier.proprietaire_id)).totaux.totalAppele).toBe(0);

        // Régénéré puis réémis : le total est celui du nouvel appel, pas la somme des deux.
        await client.query(`select app.generer_appels($1)`, [periodeId]);
        const nouveau = (await client.query(`select * from appels where proprietaire_id = $1 and statut = 'brouillon'`, [premier.proprietaire_id])).rows[0];
        await emettre(nouveau.id);

        const { appels, totaux } = await brutsDe(premier.proprietaire_id);
        expect(appels.filter((a) => a.statut === "annule")).toHaveLength(1);
        expect(appels.filter((a) => a.statut === "emis")).toHaveLength(1);
        expect(totaux.totalAppele).toBe(Number(nouveau.montant_total));
        expect(totaux.totalAppele).not.toBe(2 * montant);
        expect(totaux.solde).toBe(totaux.totalAppele);
      });
    });

    it("le total payé suit les paiements et leurs annulations ; le solde aussi", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const total = Number(a.montant_total);
        const p = await payer(a.id, 1000);
        await payer(a.id, 500, "especes");
        let { totaux } = await brutsDe(a.proprietaire_id);
        expect(totaux).toEqual({ totalAppele: total, totalPaye: 1500, solde: total - 1500 });

        await annuler(p);
        ({ totaux } = await brutsDe(a.proprietaire_id));
        expect(totaux).toEqual({ totalAppele: total, totalPaye: 500, solde: total - 500 });
      });
    });

    it("les mouvements montrent paiement et annulation, rattachés à la référence de l'appel", async () => {
      await dansSauvegarde(async () => {
        const a = await appelEmis();
        const p = await payer(a.id, 1000, "wave", "TX-7");
        await annuler(p, "Doublon");
        const { appels, paiements } = await brutsDe(a.proprietaire_id);
        const mouvements = composerMouvements(appels, paiements, new Map());
        const lignes = mouvements.filter((m) => m.type === "paiement");
        expect(lignes).toHaveLength(2);
        const origine = lignes.find((m) => !m.annulation)!;
        const inverse = lignes.find((m) => m.annulation)!;
        expect(origine).toMatchObject({ appelReference: a.reference, moyen: "wave", referenceExterne: "TX-7", annulable: false, dejaAnnule: true });
        expect(inverse).toMatchObject({ appelReference: a.reference, motif: "Doublon", annulable: false });
        expect(inverse.montant).toBe(-1000);
        // Plus rien à payer sur cet appel n'est faux : le reste dû est de nouveau entier.
        const payables = appelsPayables(appels, paiements);
        expect(payables.find((x) => x.id === a.id)?.resteDu).toBe(Number(a.montant_total));
      });
    });
  });
});
