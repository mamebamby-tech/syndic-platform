import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  adresseDuLien,
  adresseDuSite,
  ErreurUtilisation,
  estAdresseLocale,
  lireArguments,
  normaliserRetour,
} from "../scripts/dev-lien-options";

// `npm run dev:lien <email>` (scripts/dev-lien.ts) : un lien de connexion pour un
// compte de syndic-dev, sans courriel. Il ne doit JAMAIS s'exécuter contre autre
// chose que syndic-dev, avec le même garde-fou que la suite de tests.

const SCRIPT = resolve("scripts/dev-lien.ts");
const REF = "abcdefghijklmnopqrst"; // référence factice : aucune valeur réelle dans ce fichier

// Lance le script dans un dossier de travail jetable : c'est le dossier courant qui
// détermine .env.local et .env.reel, le garde-fou les lit relativement à lui.
function lancer(args: string[], fichiers: Record<string, string> = {}, env: Record<string, string> = {}) {
  const dossier = mkdtempSync(join(tmpdir(), "dev-lien-"));
  for (const [nom, contenu] of Object.entries(fichiers)) writeFileSync(join(dossier, nom), contenu);
  const sortie = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dossier,
    encoding: "utf8",
    // Environnement minimal : ni DATABASE_URL ni clés du shell ne fuient dans le test.
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env } as unknown as NodeJS.ProcessEnv,
    timeout: 30_000,
  });
  return { code: sortie.status, sortie: sortie.stdout, erreur: sortie.stderr };
}

describe("dev:lien — arguments", () => {
  it("sans adresse : refuse et dit comment l'utiliser", () => {
    const r = lancer([]);
    expect(r.code).not.toBe(0);
    expect(r.erreur).toContain("Utilisation : npm run dev:lien -- <adresse électronique> [--retour=<adresse du site>]");
  });

  it("adresse invalide : refuse avant toute connexion", () => {
    for (const invalide of ["pas-une-adresse", "a@b", "a b@example.com", "@example.com"]) {
      const r = lancer([invalide]);
      expect(r.code, invalide).not.toBe(0);
      expect(r.erreur, invalide).toContain("Adresse invalide");
    }
  });
});

describe("dev:lien — refuse toute base qui n'est pas syndic-dev", () => {
  const reel = (hote: string) =>
    `DATABASE_URL=postgresql://postgres:secret@${hote}:5432/postgres\nNEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=cle-factice\n`;

  it("l'URL de la base réelle (.env.reel) est refusée, sans aucun lien ni aucune connexion", () => {
    const r = lancer(["quelquun@example.com"], {
      ".env.reel": reel(`db.${REF}.supabase.co`),
      ".env.local": reel(`db.${REF}.supabase.co`),
    });
    expect(r.code).toBe(1);
    expect(r.erreur).toContain("COMMANDE REFUSÉE");
    expect(r.erreur).toContain("syndic-dev");
    expect(r.erreur).toContain("RÉELLE");
    expect(r.sortie).not.toContain("/auth/confirmation");
    // Ni mot de passe ni clé dans le message.
    expect(r.erreur + r.sortie).not.toContain("secret");
    expect(r.erreur + r.sortie).not.toContain("cle-factice");
  });

  it("même hôte de pooler que la base réelle, reconnue à la référence du projet dans l'identifiant", () => {
    const r = lancer(["quelquun@example.com"], {
      ".env.reel": reel(`db.${REF}.supabase.co`),
      ".env.local": `DATABASE_URL=postgresql://postgres.${REF}:secret@aws-0-eu.pooler.supabase.com:6543/postgres\nSUPABASE_SERVICE_ROLE_KEY=cle-factice\n`,
    });
    expect(r.code).toBe(1);
    expect(r.erreur).toContain("RÉEL");
  });

  it("l'ancien nom .env.production.local est lu aussi", () => {
    const r = lancer(["quelquun@example.com"], {
      ".env.production.local": reel(`db.${REF}.supabase.co`),
      ".env.local": reel(`db.${REF}.supabase.co`),
    });
    expect(r.code).toBe(1);
    expect(r.erreur).toContain("RÉELLE");
  });

  it("sans DATABASE_URL : refuse, et le dit", () => {
    const r = lancer(["quelquun@example.com"], { ".env.local": "" });
    expect(r.code).toBe(1);
    expect(r.erreur).toContain("DATABASE_URL est vide");
    expect(r.sortie).not.toContain("/auth/confirmation");
  });

  it("ne lit PAS .env.reel comme configuration : seul .env.local compte", () => {
    // .env.reel seul, .env.local vide : la commande n'utilise jamais les clés réelles.
    const r = lancer(["quelquun@example.com"], { ".env.reel": reel(`db.${REF}.supabase.co`), ".env.local": "" });
    expect(r.code).toBe(1);
    expect(r.erreur).toContain("DATABASE_URL est vide");
  });

  it("une DATABASE_URL exportée dans le shell est contrôlée aussi (la valeur effective)", () => {
    const r = lancer(
      ["quelquun@example.com"],
      { ".env.reel": reel(`db.${REF}.supabase.co`), ".env.local": "" },
      { DATABASE_URL: `postgresql://postgres:secret@db.${REF}.supabase.co:5432/postgres` },
    );
    expect(r.code).toBe(1);
    expect(r.erreur).toContain("RÉELLE");
  });
});

describe("dev:lien — option --retour : l'adresse où le lien ramène", () => {
  it("sans --retour : le comportement d'avant, NEXT_PUBLIC_SITE_URL ou localhost", () => {
    expect(lireArguments(["a@example.com"]).retour).toBeNull();
    expect(adresseDuSite(null, undefined)).toBe("http://localhost:3000");
    expect(adresseDuSite(null, "")).toBe("http://localhost:3000");
    expect(adresseDuSite(null, "http://localhost:3001/")).toBe("http://localhost:3001");
  });

  it("avec --retour : elle prime sur NEXT_PUBLIC_SITE_URL, dans n'importe quel ordre", () => {
    for (const argv of [["a@example.com", "--retour=http://192.168.1.20:3000"], ["--retour=http://192.168.1.20:3000", "a@example.com"]]) {
      const { email, retour } = lireArguments(argv);
      expect(email).toBe("a@example.com");
      expect(adresseDuSite(retour, "http://localhost:3000")).toBe("http://192.168.1.20:3000");
    }
  });

  it("le lien garde son chemin et son jeton, quelle que soit l'adresse", () => {
    expect(adresseDuLien("http://192.168.1.20:3000", "a+b/c=")).toBe(
      "http://192.168.1.20:3000/auth/confirmation?token_hash=a%2Bb%2Fc%3D&type=email",
    );
    expect(adresseDuLien("http://localhost:3000", "h")).toBe("http://localhost:3000/auth/confirmation?token_hash=h&type=email");
  });

  it("normalise : barre finale ôtée, port gardé, https accepté", () => {
    expect(normaliserRetour("http://192.168.1.20:3000/")).toBe("http://192.168.1.20:3000");
    expect(normaliserRetour("https://mon-tunnel.example.com")).toBe("https://mon-tunnel.example.com");
    expect(normaliserRetour("HTTP://LOCALHOST:3000")).toBe("http://localhost:3000");
  });

  it("refuse ce qui n'est pas l'adresse d'un site", () => {
    const refus: Array<[string, RegExp]> = [
      ["", /vide/],
      ["   ", /vide/],
      ["localhost:3000", /http et https|pas une adresse/],
      ["192.168.1.20", /pas une adresse/],
      ["ftp://exemple.com", /http et https/],
      ["javascript:alert(1)", /http et https/],
      ["file:///etc/passwd", /http et https/],
      ["http://utilisateur:mdp@exemple.com", /identifiant/],
      ["http://exemple.com/demo", /sans chemin/],
      ["http://exemple.com/?a=1", /sans chemin/],
      ["http://exemple.com/#x", /sans chemin/],
    ];
    for (const [valeur, message] of refus) {
      expect(() => normaliserRetour(valeur), JSON.stringify(valeur)).toThrow(message);
    }
  });

  it("refuse une option inconnue, une option répétée, une option sans valeur, un compte en trop", () => {
    expect(() => lireArguments(["a@example.com", "--force"])).toThrow(/Option inconnue : --force/);
    expect(() => lireArguments(["a@example.com", "--retour=http://a.io", "--retour=http://b.io"])).toThrow(/deux fois/);
    expect(() => lireArguments(["a@example.com", "--retour"])).toThrow(/attend une valeur/);
    expect(() => lireArguments(["a@example.com", "b@example.com"])).toThrow(/Un seul compte/);
    expect(() => lireArguments(["--retour=http://a.io"])).toThrow(ErreurUtilisation);
  });

  it("npm qui absorbe --retour (sans « -- ») est détecté, jamais transformé en lien vers localhost", () => {
    expect(() => lireArguments(["a@example.com"], { npm_config_retour: "http://192.168.1.20:3000" })).toThrow(
      /npm run dev:lien -- <adresse électronique> --retour=/,
    );
    // Transmis correctement : pas d'erreur.
    expect(lireArguments(["a@example.com", "--retour=http://192.168.1.20:3000"], { npm_config_retour: "http://x" }).retour).toBe(
      "http://192.168.1.20:3000",
    );
  });

  it("reconnaît une adresse locale ; le reste déclenche l'avertissement", () => {
    for (const locale of ["http://localhost:3000", "http://127.0.0.1:3000", "http://192.168.1.20:3000", "http://10.0.0.5", "http://172.16.0.1", "http://172.31.255.1", "http://mon-mac.local:3000"]) {
      expect(estAdresseLocale(locale), locale).toBe(true);
    }
    for (const distante of ["https://demo.vercel.app", "http://172.32.0.1", "http://192.169.1.1", "http://8.8.8.8", "https://mon-tunnel.example.com"]) {
      expect(estAdresseLocale(distante), distante).toBe(false);
    }
  });

  it("la commande refuse une adresse invalide AVANT toute connexion, avec le code 2", () => {
    for (const invalide of ["--retour=exemple.com", "--retour=ftp://x.io", "--retour=http://x.io/chemin", "--retour="]) {
      const r = lancer(["quelquun@example.com", invalide]);
      expect(r.code, invalide).toBe(2);
      expect(r.erreur, invalide).toContain("--retour");
      expect(r.sortie, invalide).not.toContain("/auth/confirmation");
    }
  });

  it("npm qui absorbe l'option : refus explicite, code 2, aucun lien", () => {
    const r = lancer(["quelquun@example.com"], {}, { npm_config_retour: "http://192.168.1.20:3000" });
    expect(r.code).toBe(2);
    expect(r.erreur).toContain("npm a absorbé --retour");
    expect(r.sortie).not.toContain("/auth/confirmation");
  });

  it("LE GARDE-FOU S'APPLIQUE À L'IDENTIQUE : avec --retour, la base réelle reste refusée", () => {
    const fichiers = {
      ".env.reel": `DATABASE_URL=postgresql://postgres:secret@db.${REF}.supabase.co:5432/postgres\nNEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\n`,
      ".env.local": `DATABASE_URL=postgresql://postgres:secret@db.${REF}.supabase.co:5432/postgres\nNEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=cle-factice\n`,
    };
    for (const retour of ["--retour=http://localhost:3000", "--retour=http://192.168.1.20:3000", "--retour=https://demo.vercel.app"]) {
      const r = lancer(["quelquun@example.com", retour], fichiers);
      expect(r.code, retour).toBe(1);
      expect(r.erreur, retour).toContain("COMMANDE REFUSÉE");
      expect(r.erreur, retour).toContain("RÉELLE");
      expect(r.sortie, retour).not.toContain("/auth/confirmation");
      expect(r.erreur + r.sortie, retour).not.toContain("cle-factice");
    }
    // Sans DATABASE_URL non plus : --retour ne dispense d'aucun contrôle.
    const sans = lancer(["quelquun@example.com", "--retour=http://localhost:3000"], { ".env.local": "" });
    expect(sans.code).toBe(1);
    expect(sans.erreur).toContain("DATABASE_URL est vide");
  });
});

describe("dev:lien — structure : garde-fou d'abord, aucun courriel", () => {
  const source = readFileSync("scripts/dev-lien.ts", "utf8");
  const code = source
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("appelle le garde-fou de la suite de tests, AVANT toute connexion ou création de client", () => {
    expect(code).toMatch(/from "\.\.\/tests\/garde-environnement\.ts"/);
    const garde = code.indexOf("await garderEnvironnement()");
    expect(garde).toBeGreaterThan(-1);
    for (const apres of ["new Client(", "createClient(", "generateLink("]) {
      expect(code.indexOf(apres), apres).toBeGreaterThan(garde);
    }
  });

  it("n'envoie aucun courriel : ni code, ni invitation, ni réinitialisation", () => {
    for (const interdit of ["signInWithOtp", "inviteUserByEmail", "resetPasswordForEmail", "resend(", "signUp("]) {
      expect(code, interdit).not.toContain(interdit);
    }
    expect(code).toContain("generateLink");
  });

  it("ne crée pas de compte : elle vérifie l'existence avant de générer", () => {
    expect(code.indexOf("from auth.users")).toBeGreaterThan(-1);
    expect(code.indexOf("from auth.users")).toBeLessThan(code.indexOf("generateLink("));
  });

  it("ne lit jamais les clés réelles", () => {
    expect(code).not.toMatch(/\.env\.reel|production\.local/);
  });

  it("--retour est lu AVANT le garde-fou (aucune connexion) et ne peut pas désigner la base : l'adresse ne sert qu'à construire le lien", () => {
    expect(code.indexOf("lireArguments(")).toBeLessThan(code.indexOf("await garderEnvironnement()"));
    for (const apres of ["new Client(", "createClient(", "generateLink("]) {
      expect(code.indexOf("lireArguments(")).toBeLessThan(code.indexOf(apres));
    }
    // `retour` : déclaré et affecté avec la lecture des arguments, puis utilisé seulement
    // après la génération du lien, pour l'adresse et l'affichage.
    const lecture = code.indexOf("lireArguments(");
    const generation = code.indexOf("generateLink(");
    for (const usage of code.matchAll(/\bretour\b/g)) {
      expect(usage.index! <= lecture || usage.index! > generation, `usage de retour à ${usage.index}`).toBe(true);
    }
    expect(code).not.toMatch(/DATABASE_URL\s*=/);
    expect(code).not.toMatch(/process\.env\.[A-Z_]+\s*=[^=]/);
  });

  it("est déclarée dans package.json", () => {
    expect(JSON.parse(readFileSync("package.json", "utf8")).scripts["dev:lien"]).toBe("node scripts/dev-lien.ts");
  });
});

describe("route /auth/confirmation — développement seulement", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("@/lib/supabase/server");
  });

  const requete = (query: string) => new NextRequest(`http://localhost:3000/auth/confirmation${query}`);

  async function charger(verifyOtp = vi.fn().mockResolvedValue({ error: null })) {
    vi.doMock("@/lib/supabase/server", () => ({ creerClientServeur: async () => ({ auth: { verifyOtp } }) }));
    const { GET } = await import("@/app/auth/confirmation/route");
    return { GET, verifyOtp };
  }

  it("en production : 404, sans jamais toucher à l'authentification", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { GET, verifyOtp } = await charger();
    const reponse = await GET(requete("?token_hash=abc&type=email"));
    expect(reponse.status).toBe(404);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("en développement : vérifie le jeton et redirige vers l'accueil", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { GET, verifyOtp } = await charger();
    const reponse = await GET(requete("?token_hash=abc&type=email"));
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "email" });
    expect(reponse.status).toBe(307);
    expect(new URL(reponse.headers.get("location")!).pathname).toBe("/");
  });

  it("jeton invalide ou paramètres manquants : retour à la connexion", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const refus = await charger(vi.fn().mockResolvedValue({ error: new Error("jeton expiré") }));
    expect(new URL((await refus.GET(requete("?token_hash=abc&type=email"))).headers.get("location")!).pathname).toBe("/login");

    for (const query of ["", "?token_hash=abc", "?type=email", "?token_hash=abc&type=recovery"]) {
      const { GET, verifyOtp } = await charger();
      const reponse = await GET(requete(query));
      expect(new URL(reponse.headers.get("location")!).pathname, query).toBe("/login");
      expect(verifyOtp, query).not.toHaveBeenCalled();
    }
  });
});
