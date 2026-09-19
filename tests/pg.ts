import { Client } from "pg";
import { garderEnvironnement, verifierCible } from "./garde-environnement";

// Connexion directe à Postgres (rôle propriétaire des migrations, hors RLS)
// pour tester le moteur de répartition SQL lui-même — la seule couche où
// une clé de répartition a le droit d'exister (voir docs/02-modele-donnees.md).
//
// SEUL moyen d'ouvrir une connexion dans un test (tests/garde-environnement.test.ts
// échoue sinon) : il applique le garde-fou à chaque appel, en plus du
// globalSetup. Une connexion ne s'ouvre jamais sur la base réelle ni sur une
// base qui n'est pas le jeu fictif.
export async function connecter(): Promise<Client> {
  // Avant de se connecter : refuse la base réelle sans même l'atteindre.
  const chaine = verifierCible();

  const client = new Client({ connectionString: chaine });
  await client.connect();
  try {
    await garderEnvironnement(client);
  } catch (erreur) {
    await client.end().catch(() => undefined);
    throw erreur;
  }
  return client;
}
