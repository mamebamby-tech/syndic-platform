import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Client } from "pg";
import { connecter } from "./pg";
import { essayer } from "./aides";
import { DocumentAppel } from "@/components/documents/document-appel";
import type { AppelDetail } from "@/lib/data/appels";
import {
  appelDepuisInstantane,
  contexteDepuisInstantane,
  InstantaneIllisible,
  lireInstantane,
} from "@/lib/appels/instantane";
import { VERSION_OPPOSABLE } from "@/lib/i18n/document";
import { chargerMessages } from "@/lib/i18n/messages";

// Un appel émis est un document ENVOYÉ : il ne change plus jamais
// (20260919120000_instantane_appel.sql).
//
// Ce fichier tourne dans UNE transaction annulée à la fin : il modifie les
// coordonnées bancaires et le nom de l'immeuble de dev, qui sont des réglages
// que l'on manipule à la main — rien ne doit y survivre. Les échecs attendus
// passent par des points de sauvegarde (essayer).

const IBAN_ANCIEN = "SN08 ANCIEN 1111 2222";
const IBAN_NOUVEAU = "SN99 NOUVEAU 9999 8888";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ");

describe("instantané d'un appel émis — le document ne change plus", () => {
  let client: Client;
  let immeubleId: string;
  let organisationId: string;
  let periodeId: string;
  let posteIds: string[];
  let messagesDocument: Awaited<ReturnType<typeof chargerMessages>>["Documents"];

  // Utilisateurs de test, membres du cabinet de dev le temps de la transaction.
  let gestionnaire: string;
  let lecteur: string;

  const appels = async (statut?: string) =>
    (
      await client.query(
        `select a.*, p.nom as proprietaire_nom from appels a join proprietaires p on p.id = a.proprietaire_id
         where a.periode_id = $1 and ($2::text is null or a.statut::text = $2) order by a.numero`,
        [periodeId, statut ?? null],
      )
    ).rows;
  const ligne = async (id: string) => (await client.query(`select * from appels where id = $1`, [id])).rows[0];

  // Comme un utilisateur, dans la transaction courante (voir tests/parametres-immeuble.test.ts).
  const enSession = async <T,>(utilisateurId: string, corps: () => Promise<T>): Promise<T> => {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: utilisateurId })]);
    try {
      return await corps();
    } finally {
      await client.query("reset role");
      // Les claims restent posés jusqu'à la fin de la transaction : les effacer,
      // sinon l'appel « propriétaire » suivant se ferait encore sous cette identité.
      await client.query("select set_config('request.jwt.claims', '{}', true)");
    }
  };

  // Le document d'un appel ÉMIS, tel que l'application le rend : depuis l'instantané, lui seul.
  // Les données « vivantes » passées en base sont volontairement fausses : si le
  // document en lisait un seul champ, il s'afficherait.
  const rendreEmis = (instantane: unknown) => {
    const i = lireInstantane(instantane);
    const vivantFaux: AppelDetail = {
      id: "x",
      reference: "REFERENCE-VIVANTE",
      statut: "emis",
      montantTotal: 1,
      reportAnterieur: 0,
      dateEcheance: "2000-01-01",
      dateEmission: null,
      proprietaireId: "p",
      proprietaireNom: "NOM VIVANT",
      anomalies: [],
      envoi: "pret",
      lignes: [],
      obsolete: false,
      contexteEmis: null,
    };
    const appel = appelDepuisInstantane(i, vivantFaux);
    return texte(
      renderToStaticMarkup(
        <DocumentAppel
          document={{ version: VERSION_OPPOSABLE, messages: messagesDocument }}
          contexte={appel.contexteEmis!}
          appel={appel}
        />,
      ),
    );
  };

  beforeAll(async () => {
    client = await connecter();
    messagesDocument = (await chargerMessages("fr")).Documents;
    await client.query("begin");

    const { rows } = await client.query<{ id: string; organisation_id: string }>(
      `select id, organisation_id from immeubles where nom = 'Mamelles Tower'`,
    );
    immeubleId = rows[0]!.id;
    organisationId = rows[0]!.organisation_id;

    const users = [];
    for (const [email, role] of [
      ["instantane.gestionnaire@example.com", "gestionnaire"],
      ["instantane.lecteur@example.com", "lecteur"],
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
       where pc.immeuble_id = $1 and cr.code = 'tantiemes' and pc.categorie = 'general' order by pc.ordre limit 3`,
      [immeubleId],
    );
    posteIds = postes.rows.map((p) => p.id);

    const exercice = await client.query<{ id: string }>(
      `insert into exercices (immeuble_id, libelle, date_debut, date_fin)
       values ($1, 'Exercice test instantané', '2029-01-01', '2029-12-31') returning id`,
      [immeubleId],
    );
    const periode = await client.query<{ id: string }>(
      `insert into periodes (exercice_id, libelle, date_debut, date_fin, date_echeance)
       values ($1, 'Période test instantané', '2029-01-01', '2029-03-31', '2029-01-01') returning id`,
      [exercice.rows[0]!.id],
    );
    periodeId = periode.rows[0]!.id;
    for (const [i, id] of posteIds.entries()) {
      await client.query(`insert into budget_lignes (periode_id, poste_charge_id, montant) values ($1, $2, $3)`, [
        periodeId,
        id,
        [450000, 275500.5, 89999.99][i],
      ]);
    }

    // Coordonnées de l'immeuble (dans la transaction : annulées à la fin).
    await client.query(
      `update immeubles set compte_titulaire = 'Syndicat test', compte_banque = 'Banque test',
         compte_numero = $2, compte_bic = 'ABCDSNDA', moyens_paiement_acceptes = '{wave,virement}',
         numeros_marchands = '{"wave": "77 000 00 00"}' where id = $1`,
      [immeubleId, IBAN_ANCIEN],
    );
    await client.query(`select app.generer_appels($1)`, [periodeId]);
  });

  afterAll(async () => {
    await client.query("rollback");
    await client.end();
  });

  // Chaque test qui émet le fait sur un appel qu'il choisit, dans un point de sauvegarde
  // annulé à sa fin : les tests ne se marchent pas dessus.
  const dansSauvegarde = async (corps: () => Promise<void>) => {
    await client.query("savepoint test");
    try {
      await corps();
    } finally {
      await client.query("rollback to savepoint test");
    }
  };
  const emettre = async (id: string) => client.query(`update appels set statut = 'emis' where id = $1`, [id]);
  const premierBrouillon = async () => (await appels("brouillon"))[0]!;

  describe("l'émission fige", () => {
    it("un brouillon n'a pas d'instantané", async () => {
      for (const a of await appels("brouillon")) expect(a.instantane).toBeNull();
    });

    it("au passage à émis : instantané pris, date d'émission posée", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await emettre(b.id);
        const e = await ligne(b.id);
        expect(e.statut).toBe("emis");
        expect(e.instantane).not.toBeNull();
        expect(e.instantane.version).toBe(1);
        const { rows } = await client.query(`select $1::date = current_date as ok`, [e.date_emission]);
        expect(rows[0].ok).toBe(true);
      });
    });

    it("copie TOUT ce que le document affiche", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        const lignesAvant = (await client.query(`select count(*)::int n from appel_lignes where appel_id = $1`, [b.id])).rows[0].n;
        await emettre(b.id);
        const { instantane: i } = await ligne(b.id);
        expect(i.reference).toBe(b.reference);
        expect(i.montant_total).toBe(Number(b.montant_total));
        expect(i.date_echeance).toBe("2029-01-01");
        expect(i.destinataire.nom).toBe(b.proprietaire_nom);
        expect(i.periode.libelle).toBe("Période test instantané");
        expect(i.immeuble.nom).toBe("Mamelles Tower");
        expect(i.organisation.nom).toBeTruthy();
        expect(i.lignes).toHaveLength(lignesAvant);
        expect(i.lignes[0]).toEqual(
          expect.objectContaining({ lot_numero: expect.any(Number), poste_libelle: expect.any(String), montant: expect.any(Number) }),
        );
        expect(i.reglement.compte).toEqual({
          titulaire: "Syndicat test",
          banque: "Banque test",
          numero: IBAN_ANCIEN,
          bic: "ABCDSNDA",
        });
        expect(i.reglement.moyens).toEqual(["wave", "virement"]);
        expect(i.reglement.numeros_marchands).toEqual({ wave: "77 000 00 00" });
        // Le total de l'instantané est la somme de ses lignes (+ report).
        const somme = i.lignes.reduce((t: number, l: { montant: number }) => t + l.montant, 0);
        expect(Math.round((somme + i.report_anterieur) * 100)).toBe(Math.round(i.montant_total * 100));
      });
    });

    it("le document rendu depuis l'instantané montre ce qui a été émis", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await emettre(b.id);
        const html = rendreEmis((await ligne(b.id)).instantane);
        expect(html).toContain(b.reference);
        expect(html).toContain(b.proprietaire_nom);
        expect(html).toContain(IBAN_ANCIEN);
        expect(html).toContain("Wave (numéro marchand 77 000 00 00)");
        expect(html).toContain("1er janvier 2029");
        // Rien de l'appel « vivant » (volontairement faux) ne filtre.
        expect(html).not.toContain("REFERENCE-VIVANTE");
        expect(html).not.toContain("NOM VIVANT");
      });
    });
  });

  describe("changer l'IBAN après l'émission ne change pas le document émis", () => {
    it("l'IBAN, les moyens et les numéros marchands de l'immeuble changent : le document reste identique", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await emettre(b.id);
        const avant = await ligne(b.id);
        const htmlAvant = rendreEmis(avant.instantane);
        expect(htmlAvant).toContain(IBAN_ANCIEN);

        await client.query(
          `update immeubles set compte_numero = $2, compte_titulaire = 'Autre titulaire', compte_banque = 'Autre banque',
             compte_bic = 'ZZZZSNDA', moyens_paiement_acceptes = '{especes}', numeros_marchands = '{}' where id = $1`,
          [immeubleId, IBAN_NOUVEAU],
        );
        // La base a bien changé...
        const live = (await client.query(`select compte_numero from immeubles where id = $1`, [immeubleId])).rows[0];
        expect(live.compte_numero).toBe(IBAN_NOUVEAU);

        // ...l'instantané non, et le document non plus.
        const apres = await ligne(b.id);
        expect(apres.instantane).toEqual(avant.instantane);
        const htmlApres = rendreEmis(apres.instantane);
        expect(htmlApres).toBe(htmlAvant);
        expect(htmlApres).toContain(IBAN_ANCIEN);
        expect(htmlApres).not.toContain(IBAN_NOUVEAU);
        expect(htmlApres).not.toContain("Autre titulaire");
      });
    });

    it("un appel émis APRÈS le changement porte le nouvel IBAN : chaque document dit ce qui était vrai à son émission", async () => {
      await dansSauvegarde(async () => {
        const [premier, second] = await appels("brouillon");
        await emettre(premier!.id);
        await client.query(`update immeubles set compte_numero = $2 where id = $1`, [immeubleId, IBAN_NOUVEAU]);
        await emettre(second!.id);
        expect(rendreEmis((await ligne(premier!.id)).instantane)).toContain(IBAN_ANCIEN);
        const htmlSecond = rendreEmis((await ligne(second!.id)).instantane);
        expect(htmlSecond).toContain(IBAN_NOUVEAU);
        expect(htmlSecond).not.toContain(IBAN_ANCIEN);
      });
    });

    it("le nom du copropriétaire, l'identité du cabinet, les libellés changent : le document reste identique", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await emettre(b.id);
        const avant = rendreEmis((await ligne(b.id)).instantane);

        await client.query(`update proprietaires set nom = 'NOUVEAU NOM' where id = $1`, [b.proprietaire_id]);
        await client.query(`update organisations set nom = 'NOUVEAU CABINET', ninea = 'NOUVEAU-NINEA' where id = $1`, [organisationId]);
        await client.query(`update immeubles set nom = 'NOUVEL IMMEUBLE' where id = $1`, [immeubleId]);
        await client.query(`update periodes set libelle = 'NOUVELLE PERIODE' where id = $1`, [periodeId]);
        await client.query(`update postes_charges set libelle = 'NOUVEAU POSTE' where id = any($1)`, [posteIds]);

        const apres = rendreEmis((await ligne(b.id)).instantane);
        expect(apres).toBe(avant);
        for (const nouveau of ["NOUVEAU NOM", "NOUVEAU CABINET", "NOUVEAU-NINEA", "NOUVEL IMMEUBLE", "NOUVELLE PERIODE", "NOUVEAU POSTE"]) {
          expect(apres, nouveau).not.toContain(nouveau);
        }
      });
    });

    it("à l'inverse, le document d'un BROUILLON suit les données courantes (il n'est pas encore envoyé)", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await client.query(`update proprietaires set nom = 'NOUVEAU NOM' where id = $1`, [b.proprietaire_id]);
        const vivant = (await appels("brouillon")).find((a) => a.id === b.id);
        expect(vivant.proprietaire_nom).toBe("NOUVEAU NOM");
        expect(vivant.instantane).toBeNull();
      });
    });
  });

  describe("un appel émis ne se modifie plus — la base refuse", () => {
    const MODIFICATIONS: [string, string][] = [
      ["le montant total", `montant_total = montant_total + 1`],
      ["le report antérieur", `report_anterieur = 100`],
      ["la référence", `reference = 'AUTRE-REF'`],
      ["l'échéance", `date_echeance = '2030-01-01'`],
      ["la date d'émission", `date_emission = '2000-01-01'`],
      ["le numéro d'ordre", `numero = 999`],
      ["le chemin du document", `document_path = 'x.pdf'`],
      ["l'instantané lui-même", `instantane = '{}'::jsonb`],
      ["l'instantané mis à nul", `instantane = null`],
    ];

    for (const [libelle, affectation] of MODIFICATIONS) {
      it(`refuse de modifier ${libelle}`, async () => {
        await dansSauvegarde(async () => {
          const b = await premierBrouillon();
          await emettre(b.id);
          const avant = await ligne(b.id);
          const r = await essayer(client, `update appels set ${affectation} where id = $1`, [b.id]);
          expect(r.erreur, libelle).toMatch(/ne se modifie pas|violates check constraint/);
          expect(await ligne(b.id)).toEqual(avant);
        });
      });
    }

    it("refuse de changer le destinataire ou la période", async () => {
      await dansSauvegarde(async () => {
        const [a, b] = await appels("brouillon");
        await emettre(a!.id);
        const r = await essayer(client, `update appels set proprietaire_id = $2 where id = $1`, [a!.id, b!.proprietaire_id]);
        expect(r.erreur).toMatch(/ne se modifie pas/);
      });
    });

    it("refuse le retour à brouillon", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await emettre(b.id);
        expect((await essayer(client, `update appels set statut = 'brouillon' where id = $1`, [b.id])).erreur).toMatch(
          /ne redevient pas brouillon/,
        );
      });
    });

    it("refuse de supprimer un appel émis", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await emettre(b.id);
        expect((await essayer(client, `delete from appels where id = $1`, [b.id])).erreur).toMatch(/ne se supprime pas/);
      });
    });

    it("refuse de modifier, ajouter ou supprimer une ligne d'un appel émis", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await emettre(b.id);
        const l = (await client.query(`select * from appel_lignes where appel_id = $1 limit 1`, [b.id])).rows[0];
        const raisons = [
          await essayer(client, `update appel_lignes set montant = montant + 1 where id = $1`, [l.id]),
          await essayer(client, `delete from appel_lignes where id = $1`, [l.id]),
          await essayer(
            client,
            `insert into appel_lignes (appel_id, lot_id, poste_charge_id, base_calcul, montant) values ($1, $2, $3, 1, 1)`,
            [b.id, l.lot_id, l.poste_charge_id],
          ),
        ];
        for (const r of raisons) expect(r.erreur).toMatch(/lignes d'un appel émis ne se modifient pas/);
      });
    });

    it("les lignes d'un BROUILLON restent modifiables", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        const l = (await client.query(`select id from appel_lignes where appel_id = $1 limit 1`, [b.id])).rows[0];
        expect((await essayer(client, `update appel_lignes set montant = montant where id = $1`, [l.id])).erreur).toBeNull();
      });
    });

    it("seul le statut évolue : émis → partiel → soldé, sans toucher à l'instantané", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await emettre(b.id);
        const instantane = (await ligne(b.id)).instantane;
        for (const statut of ["partiel", "solde"]) {
          expect((await essayer(client, `update appels set statut = $2 where id = $1`, [b.id, statut])).erreur, statut).toBeNull();
        }
        const fin = await ligne(b.id);
        expect(fin.statut).toBe("solde");
        expect(fin.instantane).toEqual(instantane);
      });
    });

    it("un paiement partiel reste possible même si les coordonnées bancaires ont été effacées depuis", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await emettre(b.id);
        await client.query(`update immeubles set compte_numero = null where id = $1`, [immeubleId]);
        expect((await essayer(client, `update appels set statut = 'partiel' where id = $1`, [b.id])).erreur).toBeNull();
      });
    });

    it("annuler est permis ; un appel annulé ne se modifie plus", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await emettre(b.id);
        expect((await essayer(client, `update appels set statut = 'annule' where id = $1`, [b.id])).erreur).toBeNull();
        expect((await essayer(client, `update appels set statut = 'emis' where id = $1`, [b.id])).erreur).toMatch(
          /annulé ne se modifie plus/,
        );
        expect((await essayer(client, `update appels set report_anterieur = 5 where id = $1`, [b.id])).erreur).toMatch(
          /annulé ne se modifie plus/,
        );
        // Un appel annulé garde son instantané : son document reste lisible.
        expect(rendreEmis((await ligne(b.id)).instantane)).toContain(b.reference);
      });
    });
  });

  describe("on ne fabrique pas un instantané à la main", () => {
    it("un appel ne s'insère qu'en brouillon", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        const r = await essayer(
          client,
          `insert into appels (periode_id, proprietaire_id, reference, date_echeance, statut, instantane)
           values ($1, $2, 'FAUX-001', '2029-01-01', 'emis', '{"version":1}'::jsonb)`,
          [b.periode_id, b.proprietaire_id],
        );
        expect(r.erreur).toMatch(/ne s'émet que depuis un brouillon/);
      });
    });

    it("un instantané posé sur un brouillon est effacé", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await client.query(`update appels set instantane = '{"version":1}'::jsonb, report_anterieur = 0 where id = $1`, [b.id]);
        expect((await ligne(b.id)).instantane).toBeNull();
      });
    });

    it("un appel émis sans instantané est impossible (contrainte)", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await emettre(b.id);
        // Même en contournant les déclencheurs : la contrainte tient.
        await client.query("set local session_replication_role = replica");
        const r = await essayer(client, `update appels set instantane = null where id = $1`, [b.id]);
        await client.query("set local session_replication_role = origin");
        expect(r.erreur).toMatch(/appels_instantane_requis_si_emis/);
      });
    });
  });

  describe("qui peut émettre", () => {
    it("un lecteur ne peut pas émettre", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await enSession(lecteur, async () => {
          // Refusé par la sécurité par ligne (le lecteur n'écrit nulle part) : aucune
          // ligne modifiée. Le déclencheur d'émission le refuserait aussi (message
          // « Émission réservée »), en seconde ligne.
          const r = await essayer(client, `update appels set statut = 'emis' where id = $1`, [b.id]);
          expect(r.erreur !== null || r.lignes === 0).toBe(true);
        });
        const apres = await ligne(b.id);
        expect(apres.statut).toBe("brouillon");
        expect(apres.instantane).toBeNull();
      });
    });

    it("un gestionnaire peut émettre", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await enSession(gestionnaire, async () => {
          const r = await essayer(client, `update appels set statut = 'emis' where id = $1`, [b.id]);
          expect(r.erreur).toBeNull();
        });
        expect((await ligne(b.id)).instantane).not.toBeNull();
      });
    });
  });

  describe("régénérer une période ne touche jamais un appel émis", () => {
    it("l'appel émis, ses lignes et son instantané sont intacts ; les brouillons sont recréés", async () => {
      await dansSauvegarde(async () => {
        const avantBrouillons = await appels("brouillon");
        const emisId = avantBrouillons[0]!.id;
        await emettre(emisId);
        const avant = await ligne(emisId);
        const lignesAvant = (await client.query(`select * from appel_lignes where appel_id = $1 order by id`, [emisId])).rows;

        const n = (await client.query(`select app.generer_appels($1) as n`, [periodeId])).rows[0].n;
        expect(n).toBe(avantBrouillons.length);

        expect(await ligne(emisId)).toEqual(avant);
        const lignesApres = (await client.query(`select * from appel_lignes where appel_id = $1 order by id`, [emisId])).rows;
        expect(lignesApres).toEqual(lignesAvant);
        // Aucun destinataire n'a deux appels actifs, et l'émis est le seul pour le sien.
        const { rows } = await client.query(
          `select proprietaire_id, count(*)::int n from appels where periode_id = $1 and statut <> 'annule' group by 1 having count(*) > 1`,
          [periodeId],
        );
        expect(rows).toHaveLength(0);
        expect((await appels("brouillon")).length).toBe(avantBrouillons.length - 1);
      });
    });

    it("annuler un appel émis puis régénérer permet d'en émettre un autre, avec une autre référence", async () => {
      await dansSauvegarde(async () => {
        const b = await premierBrouillon();
        await emettre(b.id);
        await client.query(`update appels set statut = 'annule' where id = $1`, [b.id]);
        await client.query(`select app.generer_appels($1)`, [periodeId]);

        const nouveau = (await appels("brouillon")).find((a) => a.proprietaire_id === b.proprietaire_id);
        expect(nouveau).toBeDefined();
        expect(nouveau.id).not.toBe(b.id);
        await emettre(nouveau.id);
        const e = await ligne(nouveau.id);
        expect(e.reference).not.toBe(b.reference);
        expect(e.instantane).not.toBeNull();
        // L'ancien, annulé, garde son instantané et sa référence.
        expect((await ligne(b.id)).reference).toBe(b.reference);
        expect((await ligne(b.id)).instantane).not.toBeNull();
      });
    });
  });

  describe("l'émission passe par la base, sans coordonnées elle échoue", () => {
    it("sans coordonnées bancaires, rien n'est émis ni figé", async () => {
      await dansSauvegarde(async () => {
        await client.query(`update immeubles set compte_numero = null where id = $1`, [immeubleId]);
        const b = await premierBrouillon();
        const r = await essayer(client, `update appels set statut = 'emis' where id = $1`, [b.id]);
        expect(r.erreur).toMatch(/coordonnées bancaires/);
        const apres = await ligne(b.id);
        expect(apres.statut).toBe("brouillon");
        expect(apres.instantane).toBeNull();
      });
    });
  });
});

describe("lecture d'un instantané — stricte, sans repli sur les données courantes", () => {
  const valide = () => ({
    version: 1,
    emis_le: "2026-10-01T09:00:00Z",
    reference: "MT-2026T4-001",
    numero: 1,
    date_echeance: "2026-10-01",
    date_emission: "2026-09-25",
    report_anterieur: 0,
    montant_total: 1000,
    destinataire: { id: "p1", nom: "Copropriétaire" },
    periode: { id: "per1", libelle: "4e trimestre 2026" },
    immeuble: { id: "i1", nom: "Immeuble" },
    organisation: { nom: "Cabinet", adresse: null, email: null, ninea: null, rccm: null },
    lignes: [{ lot_numero: 1, poste_libelle: "Poste", base_calcul: 10, montant: 1000 }],
    reglement: { compte: null, moyens: [], numeros_marchands: {}, compte_modifie_le: null },
  });

  it("lit un instantané valide", () => {
    const i = lireInstantane(valide());
    expect(i.reference).toBe("MT-2026T4-001");
    expect(i.lignes).toEqual([{ lotNumero: 1, posteLibelle: "Poste", baseCalcul: 10, montant: 1000 }]);
    expect(contexteDepuisInstantane(i).compteSyndicat).toBeNull();
  });

  it("refuse, en levant une erreur, tout instantané incomplet ou d'une autre version", () => {
    const cassures: [string, (o: Record<string, unknown>) => void][] = [
      ["version inconnue", (o) => (o.version = 2)],
      ["sans version", (o) => delete o.version],
      ["sans référence", (o) => delete o.reference],
      ["sans destinataire", (o) => delete o.destinataire],
      ["sans organisation", (o) => delete o.organisation],
      ["sans règlement", (o) => delete o.reglement],
      ["lignes qui ne sont pas une liste", (o) => (o.lignes = "x")],
      ["ligne sans montant", (o) => (o.lignes = [{ lot_numero: 1, poste_libelle: "P", base_calcul: 1 }])],
      ["total non numérique", (o) => (o.montant_total = "1000")],
    ];
    for (const [libelle, casser] of cassures) {
      const o = valide() as Record<string, unknown>;
      casser(o);
      expect(() => lireInstantane(o), libelle).toThrow(InstantaneIllisible);
    }
    for (const invalide of [null, undefined, "texte", 42, [], {}]) {
      expect(() => lireInstantane(invalide)).toThrow(InstantaneIllisible);
    }
  });

  it("appelDepuisInstantane remplace tous les champs du document, et rien ne vient de l'appel courant", () => {
    const i = lireInstantane(valide());
    const vivant: AppelDetail = {
      id: "x",
      reference: "VIVANTE",
      statut: "emis",
      montantTotal: 1,
      reportAnterieur: 9,
      dateEcheance: "2000-01-01",
      dateEmission: null,
      proprietaireId: "p",
      proprietaireNom: "VIVANT",
      anomalies: [],
      envoi: "pret",
      lignes: [{ lotNumero: 99, posteLibelle: "VIVANT", baseCalcul: 1, montant: 1 }],
      obsolete: false,
      contexteEmis: null,
    };
    const a = appelDepuisInstantane(i, vivant);
    expect(a.reference).toBe("MT-2026T4-001");
    expect(a.montantTotal).toBe(1000);
    expect(a.reportAnterieur).toBe(0);
    expect(a.dateEcheance).toBe("2026-10-01");
    expect(a.dateEmission).toBe("2026-09-25");
    expect(a.proprietaireNom).toBe("Copropriétaire");
    expect(a.lignes).toHaveLength(1);
    expect(a.lignes[0]!.posteLibelle).toBe("Poste");
    expect(a.contexteEmis?.organisationNom).toBe("Cabinet");
    expect(JSON.stringify(a)).not.toContain("VIVANT");
  });
});
