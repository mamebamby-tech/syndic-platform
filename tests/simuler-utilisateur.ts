import type { Client } from "pg";

// Simule ce que PostgREST fait à chaque requête : `set local role
// authenticated` + `set local request.jwt.claims`, dans une transaction
// systématiquement annulée en sortie — aucune écriture, réussie ou non,
// ne survit à l'appel.
export async function commeUtilisateur<T>(
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
