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

// Sessions simulées DANS la transaction courante du test (et transactions de test).
// Pour les fichiers dont les données sont validées (committées) une fois pour
// toutes en beforeAll, puis chaque test tourne dans une transaction annulée.
//
// `dejaEnTransaction` : le test a lui-même ouvert UNE transaction pour tout le
// fichier (begin en beforeAll, rollback en afterAll). Sans cela, enSession ouvrirait
// sa propre transaction puis la ANNULERAIT — et emporterait avec elle toute la
// préparation du fichier.
export function creerSessions(client: Client, options: { dejaEnTransaction?: boolean } = {}) {
  let enTransaction = options.dejaEnTransaction ?? false;

  // Transaction annulée en sortie : aucune écriture ne survit au test.
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

  const poserClaims = (utilisateurId: string | null) =>
    client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(utilisateurId ? { sub: utilisateurId } : {}),
    ]);

  // Comme PostgREST : rôle `authenticated` + identité. Dans la transaction courante
  // (une transaction est ouverte si le test n'en a pas ouvert). Les claims sont
  // effacés en sortie : ils resteraient sinon posés jusqu'à la fin de la transaction.
  const enSession = async <T>(utilisateurId: string | null, corps: () => Promise<T>): Promise<T> => {
    const propre = !enTransaction;
    if (propre) await client.query("begin");
    await client.query("set local role authenticated");
    await poserClaims(utilisateurId);
    try {
      return await corps();
    } finally {
      await client.query("reset role");
      await poserClaims(null);
      if (propre) await client.query("rollback");
    }
  };

  return { dansTransaction, enSession };
}
