import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
    expect(r.erreur).toContain("Utilisation : npm run dev:lien <adresse électronique>");
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
