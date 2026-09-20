import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  AUCUNE_PRODUCTION,
  EnvironnementDeTestInterdit,
  exigerJeuFictif,
  FICHIERS_PRODUCTION,
  hoteDe,
  identiteProduction,
  refuserBaseDeProduction,
  type IdentiteProduction,
} from "./garde-environnement";
import { connecter } from "./pg";

// Le garde-fou qui empêche la suite de tests d'écrire dans la base réelle
// (tests/garde-environnement.ts). Trois volets : la logique pure, le SQL
// contre Postgres, et la structure — car un garde-fou qu'on peut débrancher
// par oubli ne protège de rien.

// Une fausse « base réelle » : aucune valeur réelle n'apparaît dans ce fichier.
const REF = "abcdefghijklmnopqrst";
const PRODUCTION: IdentiteProduction = {
  hotes: [`db.${REF}.supabase.co`, `${REF}.supabase.co`],
  references: [REF],
};
const REF_DEV = "zyxwvutsrqponmlkjihg";

describe("hoteDe", () => {
  it("extrait l'hôte d'une URL de base ou d'API", () => {
    expect(hoteDe(`postgresql://postgres:mdp@db.${REF}.supabase.co:5432/postgres`)).toBe(
      `db.${REF}.supabase.co`,
    );
    expect(hoteDe(`https://${REF}.supabase.co`)).toBe(`${REF}.supabase.co`);
  });

  it("extrait l'hôte même si le mot de passe contient un arobase non encodé", () => {
    expect(hoteDe("postgresql://postgres:p@ss!word@db.exemple.co:5432/postgres")).toBe(
      "db.exemple.co",
    );
  });

  it("renvoie null pour une valeur vide ou absente", () => {
    expect(hoteDe(undefined)).toBeNull();
    expect(hoteDe("")).toBeNull();
  });
});

describe("identiteProduction — lue dans .env.reel (et l'ancien .env.production.local)", () => {
  const dossier = mkdtempSync(join(tmpdir(), "garde-"));

  it("extrait les hôtes et la référence du projet", () => {
    const fichier = join(dossier, "prod.env");
    writeFileSync(
      fichier,
      `DATABASE_URL=postgresql://postgres:mdp@db.${REF}.supabase.co:5432/postgres\n` +
        `NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\n`,
    );
    const id = identiteProduction(fichier);
    expect(id.hotes.sort()).toEqual([`${REF}.supabase.co`, `db.${REF}.supabase.co`].sort());
    expect(id.references).toEqual([REF]);
  });

  it("lit les deux noms de fichier : un renommage en arrière ne rend pas le garde-fou aveugle", () => {
    const reel = join(dossier, "reel.env");
    const ancien = join(dossier, "ancien.env");
    writeFileSync(reel, `DATABASE_URL=postgresql://postgres:x@db.${REF}.supabase.co:5432/postgres\n`);
    writeFileSync(ancien, `NEXT_PUBLIC_SUPABASE_URL=https://${"q".repeat(20)}.supabase.co\n`);
    const id = identiteProduction([reel, ancien, join(dossier, "absent.env")]);
    expect(id.references.sort()).toEqual([REF, "q".repeat(20)].sort());
  });

  it("les noms lus par défaut sont .env.reel et .env.production.local", () => {
    expect(FICHIERS_PRODUCTION).toEqual([".env.reel", ".env.production.local"]);
  });

  it("sans fichier (machine d'intégration continue) : aucune identité, les contrôles de contenu restent", () => {
    expect(identiteProduction(join(dossier, "absent.env"))).toEqual(AUCUNE_PRODUCTION);
  });
});

describe("refuserBaseDeProduction — refus avant toute connexion", () => {
  const dev = {
    DATABASE_URL: `postgresql://postgres:mdp@db.${REF_DEV}.supabase.co:5432/postgres`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${REF_DEV}.supabase.co`,
  };

  it("accepte une base de développement d'un autre projet", () => {
    expect(() => refuserBaseDeProduction(dev, PRODUCTION)).not.toThrow();
  });

  it("refuse le même hôte que la base réelle", () => {
    expect(() =>
      refuserBaseDeProduction(
        { DATABASE_URL: `postgresql://postgres:x@db.${REF}.supabase.co:5432/postgres` },
        PRODUCTION,
      ),
    ).toThrow(EnvironnementDeTestInterdit);
  });

  it("refuse l'URL d'API de la base réelle, même avec une DATABASE_URL de développement", () => {
    expect(() =>
      refuserBaseDeProduction({ ...dev, NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co` }, PRODUCTION),
    ).toThrow(/RÉELLE/);
  });

  it("refuse le pooler du projet réel, reconnu à sa référence dans l'identifiant", () => {
    // Hôte différent (pooler régional), mais l'utilisateur est postgres.<ref>.
    expect(() =>
      refuserBaseDeProduction(
        { DATABASE_URL: `postgresql://postgres.${REF}:x@aws-0-eu-west-3.pooler.supabase.com:6543/postgres` },
        PRODUCTION,
      ),
    ).toThrow(/projet Supabase RÉEL/);
  });

  it("refuse une URL illisible dès que la référence du projet réel y figure (échec fermé)", () => {
    // Un « / » non encodé dans le mot de passe fait analyser un autre hôte :
    // le contrôle de l'hôte seul serait aveugle, celui de la référence non.
    const illisible = `postgresql://postgres.${REF}:m@t/d@aws-0.pooler.supabase.com:6543/postgres`;
    expect(hoteDe(illisible)).toBe("t");
    expect(() => refuserBaseDeProduction({ DATABASE_URL: illisible }, PRODUCTION)).toThrow(
      /projet Supabase RÉEL/,
    );
  });

  it("refuse quelle que soit la casse", () => {
    expect(() =>
      refuserBaseDeProduction(
        { DATABASE_URL: `postgresql://postgres:x@DB.${REF.toUpperCase()}.SUPABASE.CO:5432/postgres` },
        PRODUCTION,
      ),
    ).toThrow(EnvironnementDeTestInterdit);
  });

  it("le message dit quoi faire et ne divulgue ni mot de passe ni référence complète", () => {
    try {
      refuserBaseDeProduction(
        { DATABASE_URL: `postgresql://postgres.${REF}:MOTDEPASSE@aws.pooler.supabase.com:6543/postgres` },
        PRODUCTION,
      );
      expect.unreachable();
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toMatch(/syndic-dev/);
      expect(message).toMatch(/exportée dans votre shell/);
      expect(message).not.toContain("MOTDEPASSE");
      expect(message).not.toContain(REF);
    }
  });
});

describe("exigerJeuFictif — logique, avec un faux client", () => {
  const client = (alize: unknown, reelles: unknown) => ({
    query: async (sql: string) => ({
      rows: [{ n: /SCI ALIZE/.test(sql) ? alize : reelles }],
    }),
  });

  it("accepte : SCI ALIZE présent, aucune adresse réelle", async () => {
    await expect(exigerJeuFictif(client(3, 0))).resolves.toBeUndefined();
  });

  it("s'arrête sans SCI ALIZE, avec un message explicite", async () => {
    const erreur = await exigerJeuFictif(client(0, 0), "db.exemple.co").catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(EnvironnementDeTestInterdit);
    const message = (erreur as Error).message;
    expect(message).toMatch(/aucune entité « SCI ALIZE »/);
    expect(message).toMatch(/syndic-dev/);
    expect(message).toMatch(/db\.exemple\.co/);
  });

  it("s'arrête si une adresse réelle existe, même avec SCI ALIZE", async () => {
    await expect(exigerJeuFictif(client(3, 2))).rejects.toThrow(/2 propriétaire\(s\).*hors domaines réservés/s);
  });

  it("s'arrête si la base est injoignable ou sans schéma", async () => {
    const casse = {
      query: async () => {
        throw new Error('relation "proprietaires" does not exist');
      },
    };
    await expect(exigerJeuFictif(casse)).rejects.toThrow(/impossible de vérifier/);
    await expect(exigerJeuFictif(casse)).rejects.toThrow(/does not exist/);
  });

  it("s'arrête par précaution devant une réponse inattendue (échec fermé)", async () => {
    await expect(exigerJeuFictif(client(undefined, undefined))).rejects.toThrow(EnvironnementDeTestInterdit);
    await expect(exigerJeuFictif({ query: async () => ({ rows: [] }) })).rejects.toThrow(
      EnvironnementDeTestInterdit,
    );
    await expect(exigerJeuFictif(client("abc", 0))).rejects.toThrow(EnvironnementDeTestInterdit);
  });
});

describe("exigerJeuFictif — le SQL, contre Postgres", () => {
  let client: Client;
  let immeubleId: string;

  beforeAll(async () => {
    client = await connecter();
    const { rows } = await client.query<{ id: string }>(
      `select id from immeubles where nom = 'Mamelles Tower'`,
    );
    immeubleId = rows[0]!.id;
  });
  afterAll(async () => {
    await client.end();
  });

  const dansTransaction = async (corps: () => Promise<void>) => {
    await client.query("begin");
    try {
      await corps();
    } finally {
      await client.query("rollback");
    }
  };
  const ajouter = (email: string) =>
    client.query(`insert into proprietaires (immeuble_id, nom, email) values ($1, 'Test garde', $2)`, [
      immeubleId,
      email,
    ]);

  it("passe sur la base de test (jeu fictif)", async () => {
    await expect(exigerJeuFictif(client)).resolves.toBeUndefined();
  });

  it("s'arrête dès qu'un propriétaire a une adresse réelle", async () => {
    for (const reelle of ["quelquun@gmail.com", "nom@entreprise.sn", "x@example.fr", "x@monexample.com"]) {
      await dansTransaction(async () => {
        await ajouter(reelle);
        await expect(exigerJeuFictif(client), reelle).rejects.toThrow(/hors domaines réservés/);
      });
    }
  });

  it("tolère les domaines réservés, quelle que soit la casse ou le sous-domaine", async () => {
    await dansTransaction(async () => {
      for (const fictive of ["a@example.com", "b@Example.ORG", "c@sub.example.net", "d@a.b.example.com"]) {
        await ajouter(fictive);
      }
      await expect(exigerJeuFictif(client)).resolves.toBeUndefined();
    });
  });

  it("ignore un contact sans arobase (le registre contient une adresse invalide connue)", async () => {
    await dansTransaction(async () => {
      await ajouter("kaneousmane441");
      await expect(exigerJeuFictif(client)).resolves.toBeUndefined();
    });
  });

  it("s'arrête si « SCI ALIZE » disparaît de la base", async () => {
    await dansTransaction(async () => {
      await client.query(`update proprietaires set nom = 'Autre' where nom ilike '%SCI ALIZE%'`);
      await expect(exigerJeuFictif(client)).rejects.toThrow(/aucune entité « SCI ALIZE »/);
    });
  });
});

describe("structure — le garde-fou ne peut pas être oublié", () => {
  const lire = (fichier: string) => readFileSync(fichier, "utf8");

  it("vitest.config.ts déclare le globalSetup qui garde l'environnement", () => {
    const config = lire("vitest.config.ts");
    expect(config).toMatch(/globalSetup:\s*\[\s*["']\.\/tests\/global-setup\.ts["']\s*\]/);
    expect(lire("tests/global-setup.ts")).toMatch(/garderEnvironnement\(\)/);
  });

  it("connecter() vérifie la cible avant de se connecter, puis le jeu fictif", () => {
    const pg = lire("tests/pg.ts");
    expect(pg).toMatch(/verifierCible\(\)/);
    expect(pg).toMatch(/garderEnvironnement\(client\)/);
    expect(pg.indexOf("verifierCible()")).toBeLessThan(pg.indexOf("client.connect()"));
  });

  it("aucun test n'ouvre sa propre connexion : tout passe par connecter()", () => {
    const interdits = [
      /new\s+Client\s*\(/,
      /new\s+Pool\s*\(/,
      /import\s+(?!type\b)[^;]*from\s+["']pg["']/,
      /require\(\s*["']pg["']\s*\)/,
      /from\s+["']postgres["']/,
    ];
    // dev-lien.test.ts CITE ces motifs dans ses attentes (le script ne doit pas ouvrir
    // de client avant le garde-fou) : il ne les EXÉCUTE pas, et ne se connecte à rien.
    const autorises = new Set(["pg.ts", "garde-environnement.ts", "garde-environnement.test.ts", "dev-lien.test.ts"]);
    const fichiers = readdirSync("tests").filter((f) => /\.(ts|tsx)$/.test(f));
    expect(fichiers.length).toBeGreaterThan(8);
    for (const fichier of fichiers) {
      if (autorises.has(fichier)) continue;
      const source = lire(join("tests", fichier))
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      for (const motif of interdits) expect(source, `${fichier} ${motif}`).not.toMatch(motif);
    }
  });

  it("aucun test, aucun chargeur d'environnement ne lit les clés de la base réelle", () => {
    // dev-lien.test.ts écrit de FAUX .env.reel dans des dossiers jetables pour prouver que
    // la commande les refuse ; il ne lit jamais les vrais.
    const autorises = new Set(["garde-environnement.ts", "garde-environnement.test.ts", "dev-lien.test.ts"]);
    for (const fichier of readdirSync("tests")) {
      if (autorises.has(fichier) || !/\.(ts|tsx)$/.test(fichier)) continue;
      const code = lire(join("tests", fichier))
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      expect(code, fichier).not.toMatch(/production\.local|\.env\.reel/);
    }
    expect(lire("tests/charger-env.ts")).toMatch(/path:\s*["']\.env\.local["']/);
  });
});
