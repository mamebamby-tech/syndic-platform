import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";

// Le moteur de répartition vit exclusivement dans
// supabase/migrations/20260918090200_repartition.sql (règle CLAUDE.md n°1 :
// aucune clé de répartition ne doit être réécrite en TypeScript). Ces tests
// interrogent donc directement les fonctions SQL, contre le jeu de données
// de référence Mamelles Tower — 62 lots, 10 000 tantièmes.

let client: Client;
let immeubleId: string;

beforeAll(async () => {
  client = await connecter();
  const resultat = await client.query<{ id: string }>(
    `select id from immeubles where nom = 'Mamelles Tower'`,
  );
  const immeuble = resultat.rows[0];
  if (!immeuble) {
    throw new Error(
      "Immeuble 'Mamelles Tower' introuvable : le seed a-t-il été chargé ?",
    );
  }
  immeubleId = immeuble.id;
});

afterAll(async () => {
  await client.end();
});

describe("jeu de données de référence — Mamelles Tower", () => {
  it("compte 62 lots pour 10 000 tantièmes", async () => {
    const { rows } = await client.query<{ lots: string; tantiemes: string }>(
      `select count(*) as lots, sum(tantiemes) as tantiemes
       from lots where immeuble_id = $1`,
      [immeubleId],
    );
    const ligne = rows[0]!;
    expect(Number(ligne.lots)).toBe(62);
    expect(Number(ligne.tantiemes)).toBe(10000);
  });

  it("pèse SCI ALIZE groupé à 3 946 tantièmes sur 22 lots", async () => {
    const { rows } = await client.query<{ lots: string; tantiemes: string }>(
      `select count(*) as lots, sum(l.tantiemes) as tantiemes
       from lots l
       join lot_proprietaires lp on lp.lot_id = l.id and lp.date_fin is null
       join proprietaires p on p.id = lp.proprietaire_id
       where l.immeuble_id = $1
         and coalesce(p.groupe_id, p.id) = (
           select id from proprietaires
           where immeuble_id = $1 and est_groupe = true
         )`,
      [immeubleId],
    );
    const ligne = rows[0]!;
    expect(Number(ligne.lots)).toBe(22);
    expect(Number(ligne.tantiemes)).toBe(3946);
  });

  it("pèse, dégroupé, 2 197 tantièmes sur 12 lots pour la plus grosse entité", async () => {
    const { rows } = await client.query<{
      nom: string;
      lots: string;
      tantiemes: string;
    }>(
      `select p.nom, count(*) as lots, sum(l.tantiemes) as tantiemes
       from lots l
       join lot_proprietaires lp on lp.lot_id = l.id and lp.date_fin is null
       join proprietaires p on p.id = lp.proprietaire_id
       where l.immeuble_id = $1 and p.est_groupe = false
       group by p.nom
       order by tantiemes desc
       limit 1`,
      [immeubleId],
    );
    // On n'affirme rien sur le NOM : les tests doivent passer aussi bien
    // contre le jeu fictif versionné que contre le registre réel, qui n'est
    // pas dans Git (voir donnees-privees/LISEZMOI.md).
    const plusGrosse = rows[0]!;
    expect(Number(plusGrosse.lots)).toBe(12);
    expect(Number(plusGrosse.tantiemes)).toBe(2197);
  });
});

describe("app.poids_lots — clé 'tantiemes'", () => {
  it("donne un poids à chacun des 62 lots, dont la somme vaut 10 000", async () => {
    const { rows: cle } = await client.query<{ id: string }>(
      `select id from cles_repartition where immeuble_id = $1 and code = 'tantiemes'`,
      [immeubleId],
    );
    const cleId = cle[0]!.id;

    const { rows } = await client.query<{ lot_id: string; poids: string }>(
      `select lot_id, poids from app.poids_lots($1)`,
      [cleId],
    );

    expect(rows).toHaveLength(62);
    const total = rows.reduce((somme, ligne) => somme + Number(ligne.poids), 0);
    expect(total).toBe(10000);
  });
});

describe("app.quote_part — répartition d'un montant sur les lots", () => {
  async function idPosteTantiemes(): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `select pc.id
       from postes_charges pc
       join cles_repartition cr on cr.id = pc.cle_repartition_id
       where pc.immeuble_id = $1 and cr.code = 'tantiemes'
       order by pc.ordre
       limit 1`,
      [immeubleId],
    );
    const poste = rows[0];
    if (!poste) {
      throw new Error("Aucun poste de charges sur la clé 'tantiemes' dans le seed.");
    }
    return poste.id;
  }

  it.each([1_000_000.0, 3_286_547.19, 100.0, 0.62])(
    "répartit %d XOF sur 62 lots sans écart au centime",
    async (montant) => {
      const posteId = await idPosteTantiemes();

      const { rows } = await client.query<{ lot_id: string; montant: string }>(
        `select lot_id, montant from app.quote_part($1, $2)`,
        [posteId, montant],
      );

      expect(rows).toHaveLength(62);

      const totalReparti = rows.reduce((somme, ligne) => somme + Number(ligne.montant), 0);
      // Centime près : comparaison en entier de centimes pour éviter le
      // bruit de l'arithmétique flottante côté client de test.
      expect(Math.round(totalReparti * 100)).toBe(Math.round(montant * 100));
    },
  );

  it("chaque lot reçoit une part positive ou nulle, jamais négative", async () => {
    const posteId = await idPosteTantiemes();
    const { rows } = await client.query<{ montant: string }>(
      `select montant from app.quote_part($1, $2)`,
      [posteId, 500_000.0],
    );
    for (const ligne of rows) {
      expect(Number(ligne.montant)).toBeGreaterThanOrEqual(0);
    }
  });
});
