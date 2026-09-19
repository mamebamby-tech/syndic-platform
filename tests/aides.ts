import type { Client } from "pg";

// Aides communes aux tests d'intégration qui simulent un utilisateur
// (tests/simuler-utilisateur.ts). Aucune connexion ouverte ici : tout passe par
// le client que le test a obtenu de connecter().

export interface Resultat {
  erreur: string | null;
  lignes: number;
}

// Tente une requête sans faire échouer la transaction du test : une erreur
// (with check, droit refusé, contrainte) est attendue et se mesure, pas se subit.
export async function essayer(client: Client, sql: string, params: unknown[] = []): Promise<Resultat> {
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
export async function enProprietaire<T>(client: Client, lecture: () => Promise<T>): Promise<T> {
  await client.query("reset role");
  try {
    return await lecture();
  } finally {
    await client.query("set local role authenticated");
  }
}
