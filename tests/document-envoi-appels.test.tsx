import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";
import { enProprietaire, essayer } from "./aides";
import { commeUtilisateur } from "./simuler-utilisateur";
import { lireInstantane } from "@/lib/appels/instantane";
import { composerAppel, DocumentImpossible } from "@/lib/documents/composition-appel";
import { rendrePdfAppel } from "@/lib/documents/pdf-appel";
import { chargerMessages } from "@/lib/i18n/messages";
import { VERSION_OPPOSABLE } from "@/lib/i18n/document";

// Le PDF de l'appel et la trace de son envoi (décisions 69 et 70), sur le jeu
// Mamelles Tower : instantané version 2, document composé depuis lui seul,
// enregistrement unique du PDF, trace réservée aux habilités.

describe("PDF et envoi des appels — base Mamelles Tower", () => {
  let client: Client;
  let immeubleId: string;
  let organisationId: string;
  let appelId: string;
  let instantaneBrut: unknown;
  let gestionnaire: string;
  let lecteur: string;
  const documentFr = async () => ({ version: VERSION_OPPOSABLE, messages: (await chargerMessages("fr")).Documents });

  beforeAll(async () => {
    client = await connecter();
    const { rows } = await client.query(
      `select i.id as immeuble, i.organisation_id as organisation, a.id as appel, a.instantane
       from appels a
       join periodes per on per.id = a.periode_id
       join exercices e on e.id = per.exercice_id
       join immeubles i on i.id = e.immeuble_id
       join proprietaires p on p.id = a.proprietaire_id
       where i.nom = 'Mamelles Tower' and per.libelle = '4e trimestre 2026' and p.nom = 'Moussa BA'`,
    );
    if (!rows[0]) throw new Error("Appel T4 de Moussa BA introuvable : le seed a-t-il été rechargé ?");
    ({ immeuble: immeubleId, organisation: organisationId, appel: appelId, instantane: instantaneBrut } = rows[0]);

    const cree = async (role: string) => {
      const u = (await client.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)).rows[0].id;
      await client.query(`insert into membres (organisation_id, user_id, role) values ($1, $2, $3)`, [organisationId, u, role]);
      return u as string;
    };
    gestionnaire = await cree("gestionnaire");
    lecteur = await cree("lecteur");
  });

  afterAll(async () => {
    await client.query(`delete from auth.users where id = any($1)`, [[gestionnaire, lecteur]]);
    await client.end();
  });

  describe("instantané version 2", () => {
    it("porte tout ce que le PDF imprime : lots, clé et base totale, gestionnaire, conséquences du retard", () => {
      const i = lireInstantane(instantaneBrut);
      expect(i.version).toBe(2);
      expect(i.complement).toMatchObject({
        destinataireEmail: "contact.partage@example.com",
        immeubleCodeReference: "MT",
        gestionnaire: { nom: "Aïssatou DIOP (fictive)", email: "gestion.mamelles@example.com" },
        lots: [{ numero: 12, designation: "Appartement 2B", tantiemes: 149 }],
        retard: { tauxPenalite: 0.1, penalitePar: "mensuel", requiertMiseEnDemeure: true, article: "art. 17" },
      });
      for (const l of i.complement!.lignes) expect(l).toMatchObject({ cleLibelle: "Tantièmes de l'état descriptif", baseTotale: 10_000 });
    });
  });

  describe("document", () => {
    it("composé depuis l'instantané : détail par lot et par poste, base / base totale, total, exigibilité, rappel du règlement", async () => {
      const c = composerAppel(lireInstantane(instantaneBrut), await documentFr());
      const lisible = (s: string) => s.replace(/[  ]/g, " ");
      expect(c.detail.lots).toHaveLength(1);
      expect(c.detail.lots[0]!.lignes).toHaveLength(9);
      expect(lisible(c.detail.lots[0]!.lignes[0]!.base)).toBe("149 / 10 000");
      expect(lisible(c.total.montant)).toBe("71 520 FCFA");
      expect(c.exigibilite).toBe("Somme exigible le 1er octobre 2026");
      expect(lisible(c.retard.texte)).toBe(
        "Le règlement de copropriété (art. 17) prévoit que les sommes non réglées à l'échéance portent intérêt au taux de 10 % par mois de retard, après mise en demeure restée infructueuse.",
      );
      expect(c.identification.gestionnaire.lignes).toEqual(["Aïssatou DIOP (fictive)", "gestion.mamelles@example.com"]);
      expect(lisible(c.identification.references.lignes.join(" | "))).toBe("Appel MT-2026T4-005 | Immeuble MT — Mamelles Tower");
      // Le cabinet en pied de page, et le produit nommé à côté, pas à sa place.
      expect(c.piedDePage).toMatch(/^ENIGMA AFRICA SARL/);
      expect(c.mentionProduit).toBe("Document édité avec Coprane");
    });

    it("le rappel suit le règlement, pas un texte en dur : un autre taux, une autre période, sans mise en demeure", async () => {
      const i = lireInstantane(instantaneBrut);
      const autre = {
        ...i,
        complement: { ...i.complement!, retard: { tauxPenalite: 0.015, penalitePar: "annuel", requiertMiseEnDemeure: false, delaiPaiementJours: 30, article: null } },
      };
      expect(composerAppel(autre, await documentFr()).retard.texte.replace(/[  ]/g, " ")).toBe(
        "Le règlement de copropriété prévoit que les sommes non réglées à l'échéance portent intérêt au taux de 1,5 % par an de retard.",
      );
    });

    it("refuse un instantané version 1 plutôt que de compléter avec des données courantes", async () => {
      const i = lireInstantane(instantaneBrut);
      expect(() => composerAppel({ ...i, version: 1, complement: null }, { version: VERSION_OPPOSABLE, messages: {} as never })).toThrow(
        DocumentImpossible,
      );
    });

    it("refuse un détail qui ne redonne pas le total figé", async () => {
      const i = lireInstantane(instantaneBrut);
      expect(() => composerAppel({ ...i, montantTotal: i.montantTotal + 1 }, { version: VERSION_OPPOSABLE, messages: {} as never })).toThrow(
        DocumentImpossible,
      );
    });

    it("le rendu est un PDF", async () => {
      const pdf = await rendrePdfAppel(composerAppel(lireInstantane(instantaneBrut), await documentFr()));
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(2000);
    });
  });

  describe("enregistrement du PDF : un par appel, jamais remplacé", () => {
    const chemin = () => `${immeubleId}/${appelId}.pdf`;
    const EMPREINTE = "a".repeat(64);
    // Le PDF de cet appel a pu être engendré depuis l'écran : on part d'un appel
    // sans document, dans la transaction du test (annulée en sortie).
    const sansDocument = () =>
      enProprietaire(client, () => client.query(`delete from documents_appels where appel_id = $1`, [appelId]));

    it("un habilité l'enregistre une fois ; la seconde fois est refusée", async () => {
      await commeUtilisateur(client, gestionnaire, async () => {
        await sansDocument();
        const enregistrer = () =>
          essayer(client, `select public.enregistrer_document_appel($1, $2, $3, 1234)`, [appelId, chemin(), EMPREINTE]);
        expect((await enregistrer()).erreur).toBeNull();
        expect((await enregistrer()).erreur).toMatch(/jamais remplacé/);
      });
    });

    it("un chemin autre que <immeuble>/<appel>.pdf est refusé", async () => {
      await commeUtilisateur(client, gestionnaire, async () => {
        const r = await essayer(client, `select public.enregistrer_document_appel($1, $2, $3, 1)`, [appelId, "ailleurs.pdf", EMPREINTE]);
        expect(r.erreur).toMatch(/Chemin/);
      });
    });

    it("un lecteur ne peut pas l'enregistrer, ni écrire directement dans la table", async () => {
      await commeUtilisateur(client, lecteur, async () => {
        expect((await essayer(client, `select public.enregistrer_document_appel($1, $2, $3, 1)`, [appelId, chemin(), EMPREINTE])).erreur).toMatch(
          /réservé/,
        );
        expect(
          (await essayer(client, `insert into documents_appels (appel_id, immeuble_id, chemin, empreinte, taille) values ($1, $2, $3, $4, 1)`, [
            appelId,
            immeubleId,
            chemin(),
            EMPREINTE,
          ])).erreur,
        ).toMatch(/permission denied/);
      });
    });

    it("un PDF enregistré ne se modifie ni ne se supprime", async () => {
      await commeUtilisateur(client, gestionnaire, async () => {
        await sansDocument();
        await client.query(`select public.enregistrer_document_appel($1, $2, $3, 1234)`, [appelId, chemin(), EMPREINTE]);
        expect((await essayer(client, `update documents_appels set taille = 1 where appel_id = $1`, [appelId])).erreur).toMatch(/permission denied/);
        expect((await essayer(client, `delete from documents_appels where appel_id = $1`, [appelId])).erreur).toMatch(/permission denied/);
      });
    });
  });

  describe("trace de l'envoi", () => {
    it("le gestionnaire trace un envoi : qui, vers quelle adresse, quelle référence, le résultat du service", async () => {
      await commeUtilisateur(client, gestionnaire, async () => {
        const id = (
          await client.query(`select public.tracer_envoi_appel($1, 'email', 'moi@domaine-reel.sn', 'contact.partage@example.com', true, $2) as id`, [
            appelId,
            JSON.stringify({ reussi: true, identifiant: "re_123", service: "resend" }),
          ])
        ).rows[0].id;
        const { rows } = await client.query(`select acteur_id, action, entite_id, apres from journal where id = $1`, [id]);
        expect(rows[0]).toMatchObject({ acteur_id: gestionnaire, action: "appel_envoye", entite_id: appelId });
        expect(rows[0].apres).toMatchObject({
          reference: "MT-2026T4-005",
          canal: "email",
          adresse: "moi@domaine-reel.sn",
          adresse_prevue: "contact.partage@example.com",
          redirige: true,
          resultat: { identifiant: "re_123" },
        });
      });
    });

    it("un échec est tracé comme tel", async () => {
      await commeUtilisateur(client, gestionnaire, async () => {
        const id = (await client.query(`select public.tracer_envoi_appel($1, 'email', 'x@domaine-reel.sn', null, false, '{}') as id`, [appelId])).rows[0].id;
        expect((await client.query(`select action from journal where id = $1`, [id])).rows[0].action).toBe("appel_envoi_echoue");
      });
    });

    it("un lecteur, ou une session anonyme, ne peut pas tracer d'envoi", async () => {
      for (const utilisateur of [lecteur, null]) {
        await commeUtilisateur(client, utilisateur, async () => {
          const r = await essayer(client, `select public.tracer_envoi_appel($1, 'email', 'x@domaine-reel.sn', null, true, '{}')`, [appelId]);
          expect(r.erreur).toMatch(/réservé|permission denied/);
        });
      }
    });
  });
});
