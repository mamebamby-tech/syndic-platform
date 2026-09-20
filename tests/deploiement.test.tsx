import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { BandeauDemonstration } from "@/components/ui/bandeau-demonstration";
import { enDemonstration, reglesRobots, robotsDeLaPage } from "@/lib/demonstration";
import { verifierEnvSupabase } from "@/lib/supabase/env";
import fr from "@/messages/fr.json";

// Déploiement de démonstration (docs/09-deploiement.md) : aucun secret côté navigateur,
// indexation interdite en démonstration seulement, bandeau, variables documentées.

const fichiers = (dossier: string): string[] =>
  readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (nom === "node_modules" || nom === ".next") return [];
    return statSync(chemin).isDirectory() ? fichiers(chemin) : /\.(ts|tsx)$/.test(nom) ? [chemin] : [];
  });
const CODE_APPLICATION = [...fichiers("app"), ...fichiers("lib"), ...fichiers("components"), ...fichiers("i18n"), "proxy.ts", "next.config.ts"];
const lire = (f: string) => readFileSync(f, "utf8");
const sansCommentaires = (f: string) =>
  lire(f)
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

describe("aucune clé service_role côté navigateur", () => {
  it("le code de l'application ne lit jamais la clé service_role, ni aucune variable de connexion directe", () => {
    for (const fichier of CODE_APPLICATION) {
      const code = lire(fichier);
      expect(code, fichier).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
      expect(code, fichier).not.toMatch(/process\.env\.DATABASE_URL/);
    }
  });

  it("aucune variable NEXT_PUBLIC_ ne porte un secret : ni service_role, ni mot de passe, ni jeton, ni base", () => {
    const noms = lire(".env.example")
      .split("\n")
      .map((l) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
      .filter((n): n is string => Boolean(n));
    const publiques = noms.filter((n) => n.startsWith("NEXT_PUBLIC_"));
    expect(publiques.sort()).toEqual(["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL"]);
    for (const nom of publiques) expect(nom, nom).not.toMatch(/SERVICE|SECRET|ROLE|PASSWORD|DATABASE|TOKEN|WEBHOOK/);
  });

  it("aucun fichier de l'application n'est marqué 'use client' ET ne lit une variable non publique", () => {
    for (const fichier of CODE_APPLICATION) {
      const code = lire(fichier);
      if (!/^["']use client["']/m.test(code)) continue;
      for (const [, nom] of code.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        expect(nom, fichier).toMatch(/^NEXT_PUBLIC_/);
      }
    }
  });

  it("l'application refuse de démarrer si la clé « anon » est en réalité une clé service_role", () => {
    const jeton = (role: string) =>
      `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role, ref: "x" })).toString("base64url")}.signature`;
    const base = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" };
    expect(() => verifierEnvSupabase({ ...base, NEXT_PUBLIC_SUPABASE_ANON_KEY: jeton("service_role") })).toThrow(/service_role/);
    expect(verifierEnvSupabase({ ...base, NEXT_PUBLIC_SUPABASE_ANON_KEY: jeton("anon") })).toEqual({
      url: "https://x.supabase.co",
      cleAnonyme: jeton("anon"),
    });
    // Nouveau format de clé publique : pas un jeton lisible, accepté.
    expect(verifierEnvSupabase({ ...base, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abc" }).cleAnonyme).toBe("sb_publishable_abc");
  });

  it("une variable absente est nommée, avec l'écran où la trouver", () => {
    expect(() => verifierEnvSupabase({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL.*Project Settings > API/);
    expect(() => verifierEnvSupabase({ NEXT_PUBLIC_SUPABASE_URL: "https://x", NEXT_PUBLIC_SUPABASE_ANON_KEY: "  " })).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});

describe("mode démonstration : DEMONSTRATION=1", () => {
  const avant = process.env.DEMONSTRATION;
  afterEach(() => {
    if (avant === undefined) delete process.env.DEMONSTRATION;
    else process.env.DEMONSTRATION = avant;
  });

  it("n'est actif que pour la valeur exacte « 1 »", () => {
    for (const valeur of [undefined, "", "0", "true", "oui", " 1"]) {
      if (valeur === undefined) delete process.env.DEMONSTRATION;
      else process.env.DEMONSTRATION = valeur;
      expect(enDemonstration(), String(valeur)).toBe(false);
    }
    process.env.DEMONSTRATION = "1";
    expect(enDemonstration()).toBe(true);
  });

  it("robots.txt : tout interdit en démonstration, rien d'interdit sinon", () => {
    process.env.DEMONSTRATION = "1";
    expect(reglesRobots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    delete process.env.DEMONSTRATION;
    expect(reglesRobots()).toEqual({ rules: { userAgent: "*", allow: "/" } });
  });

  it("balise robots : noindex, nofollow en démonstration ; aucune balise sinon (production plus tard)", () => {
    process.env.DEMONSTRATION = "1";
    expect(robotsDeLaPage()).toEqual({ index: false, follow: false });
    delete process.env.DEMONSTRATION;
    expect(robotsDeLaPage()).toBeUndefined();
  });

  it("la variable n'est pas exposée au navigateur : ce n'est pas une NEXT_PUBLIC_", () => {
    expect(lire("lib/demonstration.ts")).toMatch(/process\.env\.DEMONSTRATION\b/);
    expect(lire("lib/demonstration.ts")).not.toMatch(/NEXT_PUBLIC_DEMONSTRATION/);
  });

  it("le bandeau porte le texte demandé, et le layout ne l'affiche qu'en démonstration", () => {
    expect(fr.Demonstration.bandeau).toBe("Version de démonstration — données fictives");
    const html = renderToStaticMarkup(<BandeauDemonstration texte={fr.Demonstration.bandeau} />);
    expect(html).toContain("Version de démonstration — données fictives");
    const layout = lire("app/layout.tsx");
    expect(layout).toMatch(/enDemonstration\(\)\s*&&\s*<BandeauDemonstration/);
    expect(layout).toMatch(/robots:\s*robotsDeLaPage\(\)/);
  });

  it("le bandeau n'emploie que des jetons de la charte : aucune couleur en dur", () => {
    const source = lire("components/ui/bandeau-demonstration.tsx");
    const classes = /className="([^"]+)"/.exec(source)![1]!;
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:rgb|hsl)a?\(/);
    expect(classes).not.toMatch(/\[/); // pas de valeur arbitraire : bg-[#…], text-[…]
    const jetons = lire("tailwind.config.ts");
    const utilitaires = new Set(["text-xs", "text-center", "border-b"]); // taille, alignement, épaisseur : pas des couleurs
    const couleurs = classes.split(/\s+/).filter((c) => /^(?:bg|text|border)-/.test(c) && !utilitaires.has(c));
    expect(couleurs.sort()).toEqual(["bg-alerte-doux", "border-filet", "text-alerte"]);
    for (const c of couleurs) {
      const jeton = c.replace(/^(?:bg|text|border)-/, "");
      expect(jetons, `${c} : « ${jeton} » n'est pas un jeton de tailwind.config.ts`).toMatch(new RegExp(`["']?${jeton}["']?:\\s*"#`));
    }
  });

  it("le proxy d'authentification laisse passer /robots.txt", () => {
    expect(lire("proxy.ts")).toMatch(/\(\?!.*robots\.txt/);
  });
});

describe("docs/09-deploiement.md — les variables à saisir sont exactement celles que le code lit", () => {
  const lues = new Set(
    CODE_APPLICATION.flatMap((f) => [...sansCommentaires(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]!)),
  );
  lues.delete("NODE_ENV"); // posée par Vercel, pas saisie

  it("le fichier existe et son tableau des variables à saisir liste chaque variable lue, et elles seules", () => {
    const doc = lire("docs/09-deploiement.md");
    const section = /## Variables à saisir dans Vercel([\s\S]*?)\n## /.exec(doc)?.[1] ?? "";
    const documentees = new Set([...section.matchAll(/^\|\s*`([A-Z][A-Z0-9_]*)`/gm)].map((m) => m[1]!));
    expect([...documentees].sort()).toEqual([...lues].sort());
  });

  it("la clé service_role et la connexion directe figurent dans la liste des variables à NE PAS saisir", () => {
    const doc = lire("docs/09-deploiement.md");
    const interdites = /## Variables à ne pas saisir([\s\S]*?)(\n## |$)/.exec(doc)?.[1] ?? "";
    expect(interdites).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(interdites).toContain("DATABASE_URL");
  });
});
