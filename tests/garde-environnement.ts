import { readFileSync, existsSync } from "node:fs";
import { config, parse } from "dotenv";
import { Client } from "pg";

// GARDE-FOU : la suite de tests écrit dans la base (elle sème des lignes,
// génère des appels, modifie des rôles). Elle ne doit tourner QUE sur le jeu
// fictif — jamais sur la base qui contient le registre réel.
//
// Ce module est appelé à deux endroits, pour qu'aucun oubli ne le désactive :
//   - tests/global-setup.ts, déclaré dans vitest.config.ts : avant tout fichier
//     de test, et un échec abandonne toute la suite ;
//   - tests/pg.ts (`connecter`), seul moyen d'ouvrir une connexion en test.
// tests/garde-environnement.test.ts échoue si l'un des deux disparaît.
//
// Trois contrôles, du moins coûteux au plus probant :
//   1. l'URL n'est pas celle de la base réelle (fichier .env.reel) ;
//   2. la base contient « SCI ALIZE », entité du jeu fictif — absente du
//      registre réel ;
//   3. aucun propriétaire n'a d'adresse électronique hors des domaines
//      réservés (example.com, .org, .net) : la base ne contient aucune donnée
//      personnelle réelle. Ce dernier contrôle protège même si un jour le
//      registre réel contenait, lui aussi, une entité « SCI ALIZE ».
//
// En cas de doute, on s'arrête : toute erreur — connexion impossible, schéma
// absent, réponse inattendue — arrête la suite, jamais l'inverse.

// Fichiers qui portent les clés de la base RÉELLE. `.env.reel` est le nom
// actuel — que Next.js ne charge JAMAIS. L'ancien nom, `.env.production.local`,
// est lu aussi : Next le charge pour `next build` / `next start`, et un
// renommage en arrière ne doit pas rendre le garde-fou aveugle.
export const FICHIERS_PRODUCTION = [".env.reel", ".env.production.local"];

export class EnvironnementDeTestInterdit extends Error {
  constructor(message: string) {
    super(`\n\n  ⛔  TESTS ARRÊTÉS — ${message}\n`);
    this.name = "EnvironnementDeTestInterdit";
  }
}

export interface Environnement {
  DATABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
}

// Ce qui identifie la base réelle : ses hôtes, et la référence de son projet
// Supabase (présente dans l'URL de l'API et dans l'identifiant du pooler).
export interface IdentiteProduction {
  hotes: string[];
  references: string[];
}

export const AUCUNE_PRODUCTION: IdentiteProduction = { hotes: [], references: [] };

export function hoteDe(valeur: string | undefined): string | null {
  if (!valeur) return null;
  try {
    return new URL(valeur).hostname.toLowerCase();
  } catch {
    // Mot de passe contenant des caractères spéciaux non encodés : URL non
    // analysable, on extrait l'hôte à la main plutôt que de le perdre.
    const m = /@([^:/?#@]+)(?:[:/?#]|$)/.exec(valeur);
    return m ? m[1]!.toLowerCase() : null;
  }
}

export function identiteProduction(
  chemins: string | string[] = FICHIERS_PRODUCTION,
): IdentiteProduction {
  const presents = [chemins].flat().filter((chemin) => existsSync(chemin));
  if (presents.length === 0) return AUCUNE_PRODUCTION;
  const hotes = presents
    .map((chemin) => parse(readFileSync(chemin, "utf8")))
    .flatMap((valeurs) => [hoteDe(valeurs.DATABASE_URL), hoteDe(valeurs.NEXT_PUBLIC_SUPABASE_URL)])
    .filter((h): h is string => h !== null);
  const references = hotes
    .map((h) => /^(?:db\.)?([a-z0-9]{15,})\.supabase\.(?:co|com)$/.exec(h)?.[1])
    .filter((r): r is string => Boolean(r));
  return { hotes: [...new Set(hotes)], references: [...new Set(references)] };
}

export function refuserBaseDeProduction(env: Environnement, prod: IdentiteProduction): void {
  const brutes = [env.DATABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL].filter(Boolean) as string[];
  for (const brute of brutes) {
    const hote = hoteDe(brute);
    if (hote && prod.hotes.includes(hote)) {
      throw new EnvironnementDeTestInterdit(
        `l'URL de test pointe vers l'hôte de la base RÉELLE (${hote}, listé dans .env.reel ou .env.production.local).\n` +
          `  Les tests écrivent dans la base : ils ne tournent que sur syndic-dev.\n` +
          `  Corrigez .env.local — et vérifiez que DATABASE_URL n'est pas exportée dans votre shell.`,
      );
    }
    for (const reference of prod.references) {
      if (brute.toLowerCase().includes(reference)) {
        throw new EnvironnementDeTestInterdit(
          `l'URL de test contient la référence du projet Supabase RÉEL (${reference.slice(0, 4)}…).\n` +
            `  Les tests écrivent dans la base : ils ne tournent que sur syndic-dev.\n` +
            `  Corrigez .env.local — et vérifiez que DATABASE_URL n'est pas exportée dans votre shell.`,
        );
      }
    }
  }
}

type Requeteur = { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> };

// Domaines réservés (RFC 2606) : jamais une vraie boîte aux lettres.
export async function exigerJeuFictif(client: Requeteur, hote = "hôte inconnu"): Promise<void> {
  const cible = `(base : ${hote})`;
  let alize: number;
  let reelles: number;

  try {
    const a = await client.query(
      `select count(*)::int as n from proprietaires where nom ilike '%SCI ALIZE%'`,
    );
    const r = await client.query(
      `select count(*)::int as n from proprietaires
       where email like '%@%' and email !~* '@([a-z0-9-]+\\.)*example\\.(com|org|net)$'`,
    );
    alize = Number(a.rows[0]?.n);
    reelles = Number(r.rows[0]?.n);
  } catch (erreur) {
    throw new EnvironnementDeTestInterdit(
      `impossible de vérifier que la base est le jeu fictif ${cible} : ` +
        `${erreur instanceof Error ? erreur.message : String(erreur)}.\n` +
        `  Le schéma est-il appliqué et supabase/seed/seed.sql chargé sur syndic-dev ?`,
    );
  }

  if (!Number.isFinite(alize) || !Number.isFinite(reelles)) {
    throw new EnvironnementDeTestInterdit(`réponse inattendue de la base ${cible} : arrêt par précaution.`);
  }
  if (alize < 1) {
    throw new EnvironnementDeTestInterdit(
      `cette base n'est pas le jeu fictif ${cible} : aucune entité « SCI ALIZE ».\n` +
        `  Les tests écrivent dans la base : ils ne tournent que sur syndic-dev, chargée avec\n` +
        `  supabase/seed/seed.sql. Vérifiez DATABASE_URL dans .env.local.`,
    );
  }
  if (reelles > 0) {
    throw new EnvironnementDeTestInterdit(
      `cette base contient ${reelles} propriétaire(s) avec une adresse électronique hors domaines réservés ${cible} :\n` +
        `  ce sont des données réelles, pas le jeu fictif. Les tests ne tournent que sur des données\n` +
        `  fictives (adresses en example.com / .org / .net).`,
    );
  }
}

let confirmee = false;

// Contrôle de la CIBLE, avant toute connexion : on ne se connecte même pas à
// la base réelle. Renvoie l'URL de connexion.
export function verifierCible(): string {
  // .env.local uniquement : jamais .env.reel. dotenv n'écrase pas
  // une variable déjà exportée dans le shell — c'est la valeur EFFECTIVE qui
  // est contrôlée.
  config({ path: ".env.local", quiet: true });

  const url = process.env.DATABASE_URL;
  if (!url || url.trim().length === 0) {
    throw new EnvironnementDeTestInterdit(
      "DATABASE_URL est vide dans .env.local.\n" +
        "  Renseignez-la avec la chaîne de connexion de syndic-dev (base fictive), puis appliquez\n" +
        "  les migrations et le seed sur ce projet — voir README, « Environnements ».",
    );
  }

  refuserBaseDeProduction(
    {
      DATABASE_URL: process.env.DATABASE_URL,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    },
    identiteProduction(),
  );
  return url;
}

// Chemin complet : cible, connexion, jeu fictif. Sans effet si déjà confirmé
// dans ce processus.
export async function garderEnvironnement(client?: Client): Promise<void> {
  if (confirmee) return;
  const url = verifierCible();

  const propre = client ?? new Client({ connectionString: url });
  try {
    if (!client) await propre.connect();
    await exigerJeuFictif(propre, hoteDe(url) ?? undefined);
  } catch (erreur) {
    if (erreur instanceof EnvironnementDeTestInterdit) throw erreur;
    throw new EnvironnementDeTestInterdit(
      `connexion à la base impossible (${hoteDe(url) ?? "hôte inconnu"}) : ` +
        `${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  } finally {
    if (!client) await propre.end().catch(() => undefined);
  }
  confirmee = true;
}
