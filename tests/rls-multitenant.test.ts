import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";

// Vérifie que periodes / budget_lignes et public.generer_appels() isolent
// bien les cabinets entre eux (CLAUDE.md règle n°2), en simulant un
// utilisateur authentifié comme le ferait PostgREST : `set local role
// authenticated` + `set local request.jwt.claims`. La politique d'origine
// de ces deux tables ('using (true)') ne filtrait sur aucun périmètre —
// voir supabase/migrations/20260919010000_periodes_budget_rls.sql.

async function commeUtilisateur<T>(
  client: Client,
  userId: string | null,
  requete: () => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      userId ? JSON.stringify({ sub: userId }) : "{}",
    ]);
    return await requete();
  } finally {
    await client.query("rollback");
    await client.query("reset role");
  }
}

describe("sécurité par ligne — periodes, budget_lignes, generer_appels", () => {
  let client: Client;
  let periodeMamellesId: string;
  let budgetLigneMamellesId: string;
  let userGestionnaireMamelles: string;
  let userGestionnaireAutreCabinet: string;
  let autreOrganisationId: string;
  let autreImmeubleId: string;

  beforeAll(async () => {
    client = await connecter();

    const { rows: immeuble } = await client.query<{ id: string; organisation_id: string }>(
      `select id, organisation_id from immeubles where nom = 'Mamelles Tower'`,
    );
    const mamelles = immeuble[0];
    if (!mamelles) throw new Error("Immeuble 'Mamelles Tower' introuvable.");

    const { rows: periode } = await client.query<{ id: string }>(
      `select p.id from periodes p
       join exercices e on e.id = p.exercice_id
       where e.immeuble_id = $1 order by p.date_debut desc limit 1`,
      [mamelles.id],
    );
    periodeMamellesId = periode[0]!.id;

    const { rows: budgetLigne } = await client.query<{ id: string }>(
      `select id from budget_lignes where periode_id = $1 limit 1`,
      [periodeMamellesId],
    );
    budgetLigneMamellesId = budgetLigne[0]!.id;

    // Un cabinet et un immeuble sans aucun rapport avec Mamelles Tower.
    const org = await client.query<{ id: string }>(
      `insert into organisations (nom, slug) values ('Cabinet Test Isolation', 'test-isolation-rls')
       returning id`,
    );
    autreOrganisationId = org.rows[0]!.id;

    const autreImmeuble = await client.query<{ id: string }>(
      `insert into immeubles (organisation_id, nom) values ($1, 'Immeuble Test Isolation')
       returning id`,
      [autreOrganisationId],
    );
    autreImmeubleId = autreImmeuble.rows[0]!.id;

    const userA = await client.query<{ id: string }>(
      `insert into auth.users (id) values (gen_random_uuid()) returning id`,
    );
    userGestionnaireMamelles = userA.rows[0]!.id;
    await client.query(
      `insert into membres (organisation_id, user_id, role) values ($1, $2, 'gestionnaire')`,
      [mamelles.organisation_id, userGestionnaireMamelles],
    );

    const userB = await client.query<{ id: string }>(
      `insert into auth.users (id) values (gen_random_uuid()) returning id`,
    );
    userGestionnaireAutreCabinet = userB.rows[0]!.id;
    await client.query(
      `insert into membres (organisation_id, user_id, role) values ($1, $2, 'gestionnaire')`,
      [autreOrganisationId, userGestionnaireAutreCabinet],
    );
  });

  afterAll(async () => {
    await client.query(`delete from immeubles where id = $1`, [autreImmeubleId]);
    await client.query(`delete from organisations where id = $1`, [autreOrganisationId]);
    await client.query(`delete from auth.users where id = any($1)`, [
      [userGestionnaireMamelles, userGestionnaireAutreCabinet],
    ]);
    await client.end();
  });

  it("un gestionnaire d'un autre cabinet ne voit pas la période de Mamelles Tower", async () => {
    const { rows } = await commeUtilisateur(client, userGestionnaireAutreCabinet, () =>
      client.query(`select id from periodes where id = $1`, [periodeMamellesId]),
    );
    expect(rows).toHaveLength(0);
  });

  it("un gestionnaire d'un autre cabinet ne voit pas la ligne de budget de Mamelles Tower", async () => {
    const { rows } = await commeUtilisateur(client, userGestionnaireAutreCabinet, () =>
      client.query(`select id from budget_lignes where id = $1`, [budgetLigneMamellesId]),
    );
    expect(rows).toHaveLength(0);
  });

  it("un gestionnaire d'un autre cabinet ne peut pas modifier le budget de Mamelles Tower", async () => {
    const { rowCount } = await commeUtilisateur(client, userGestionnaireAutreCabinet, () =>
      client.query(`update budget_lignes set montant = 999999 where id = $1`, [
        budgetLigneMamellesId,
      ]),
    );
    expect(rowCount).toBe(0);
  });

  it("public.generer_appels refuse un gestionnaire d'un autre cabinet", async () => {
    // La RLS sur `periodes` bloque déjà la lecture avant même le contrôle
    // explicite : l'un ou l'autre message est un rejet correct, jamais un succès.
    await expect(
      commeUtilisateur(client, userGestionnaireAutreCabinet, () =>
        client.query(`select public.generer_appels($1)`, [periodeMamellesId]),
      ),
    ).rejects.toThrow(/non autorisé|introuvable/i);
  });

  it("public.generer_appels refuse un utilisateur non authentifié", async () => {
    await expect(
      commeUtilisateur(client, null, () =>
        client.query(`select public.generer_appels($1)`, [periodeMamellesId]),
      ),
    ).rejects.toThrow();
  });

  it("le gestionnaire du bon cabinet voit et modifie la période de Mamelles Tower", async () => {
    const lecture = await commeUtilisateur(client, userGestionnaireMamelles, () =>
      client.query(`select id from periodes where id = $1`, [periodeMamellesId]),
    );
    expect(lecture.rows).toHaveLength(1);

    const ecriture = await commeUtilisateur(client, userGestionnaireMamelles, () =>
      client.query(`update budget_lignes set montant = montant where id = $1`, [
        budgetLigneMamellesId,
      ]),
    );
    expect(ecriture.rowCount).toBe(1);
  });

  it("public.generer_appels fonctionne pour le gestionnaire du bon cabinet", async () => {
    const { rows } = await commeUtilisateur(client, userGestionnaireMamelles, () =>
      client.query<{ generer_appels: number }>(`select public.generer_appels($1)`, [
        periodeMamellesId,
      ]),
    );
    expect(rows[0]!.generer_appels).toBeGreaterThanOrEqual(0);
  });
});
