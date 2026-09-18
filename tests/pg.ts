import { Client } from "pg";

// Connexion directe à Postgres (rôle propriétaire des migrations, hors RLS)
// pour tester le moteur de répartition SQL lui-même — la seule couche où
// une clé de répartition a le droit d'exister (voir docs/02-modele-donnees.md).
export async function connecter(): Promise<Client> {
  const chaine = process.env.DATABASE_URL;
  if (!chaine || chaine.trim().length === 0) {
    throw new Error(
      "DATABASE_URL manquante ou invalide dans .env.local : impossible de tester " +
        "le moteur de répartition contre la base réelle.",
    );
  }

  const client = new Client({ connectionString: chaine });
  await client.connect();
  return client;
}
