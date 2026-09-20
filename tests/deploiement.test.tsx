import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { BandeauDemonstration } from "@/components/ui/bandeau-demonstration";
import { enDemonstration, enProduction, reglesRobots, robotsDeLaPage } from "@/lib/demonstration";
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

describe("mode démonstration par défaut : la production doit être PROUVÉE", () => {
  const VARIABLES = ["URL_SUPABASE_PRODUCTION", "NEXT_PUBLIC_SUPABASE_URL", "DEMONSTRATION"] as const;
  const avant = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
  afterEach(() => {
    for (const v of VARIABLES) {
      if (avant[v] === undefined) delete process.env[v];
      else process.env[v] = avant[v];
    }
  });
  // Pose exactement les valeurs données ; `undefined` retire la variable.
  const poser = (production: string | undefined, publique: string | undefined) => {
    for (const [nom, valeur] of [["URL_SUPABASE_PRODUCTION", production], ["NEXT_PUBLIC_SUPABASE_URL", publique]] as const) {
      if (valeur === undefined) delete process.env[nom];
      else process.env[nom] = valeur;
    }
  };
  const REELLE = "https://reelle0000000000000.supabase.co";

  it("production SEULEMENT si les deux adresses sont non vides et exactement égales", () => {
    poser(REELLE, REELLE);
    expect(enProduction()).toBe(true);
    expect(enDemonstration()).toBe(false);
  });

  it("variable de production absente, vide ou blanche : démonstration", () => {
    for (const production of [undefined, "", "   ", "\n"]) {
      poser(production, REELLE);
      expect(enDemonstration(), JSON.stringify(production)).toBe(true);
    }
  });

  it("deux variables absentes, ou deux variables vides — donc « égales » — ne font PAS une production", () => {
    poser(undefined, undefined);
    expect(enDemonstration()).toBe(true);
    poser("", "");
    expect(enDemonstration()).toBe(true);
    poser("   ", "   ");
    expect(enDemonstration()).toBe(true);
  });

  it("l'adresse de la base reliée absente : démonstration", () => {
    poser(REELLE, undefined);
    expect(enDemonstration()).toBe(true);
  });

  it("une différence, même d'un caractère, donne la démonstration : aucune tolérance", () => {
    const variantes = [
      `${REELLE}/`, // barre finale
      REELLE.replace("https", "http"),
      REELLE.toUpperCase(),
      REELLE.replace("reelle", "Reelle"),
      ` ${REELLE}`,
      `${REELLE} `,
      `${REELLE}\n`,
      REELLE.slice(0, -1),
      `${REELLE}x`,
      "https://syndic-dev-fictive000000.supabase.co",
    ];
    for (const publique of variantes) {
      poser(REELLE, publique);
      expect(enDemonstration(), JSON.stringify(publique)).toBe(true);
    }
    // Et dans l'autre sens : la valeur attendue légèrement fausse.
    for (const production of variantes) {
      poser(production, REELLE);
      expect(enDemonstration(), JSON.stringify(production)).toBe(true);
    }
  });

  it("l'ancienne variable DEMONSTRATION n'a plus aucun effet, et n'est plus lue", () => {
    poser(undefined, REELLE);
    process.env.DEMONSTRATION = "0";
    expect(enDemonstration()).toBe(true);
    poser(REELLE, REELLE);
    process.env.DEMONSTRATION = "1";
    expect(enDemonstration()).toBe(false);
    for (const fichier of CODE_APPLICATION) expect(sansCommentaires(fichier), fichier).not.toMatch(/DEMONSTRATION\b/);
  });

  it("robots.txt : tout interdit sauf en production prouvée", () => {
    poser(undefined, REELLE);
    expect(reglesRobots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    poser(REELLE, `${REELLE}/`);
    expect(reglesRobots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    poser(REELLE, REELLE);
    expect(reglesRobots()).toEqual({ rules: { userAgent: "*", allow: "/" } });
  });

  it("balise robots : noindex, nofollow sauf en production prouvée", () => {
    poser(undefined, undefined);
    expect(robotsDeLaPage()).toEqual({ index: false, follow: false });
    poser("", REELLE);
    expect(robotsDeLaPage()).toEqual({ index: false, follow: false });
    poser(REELLE, REELLE);
    expect(robotsDeLaPage()).toBeUndefined();
  });

  it("la variable de production est serveur uniquement : pas de NEXT_PUBLIC_, et aucun fichier navigateur ne charge le module", () => {
    expect(sansCommentaires("lib/demonstration.ts")).toMatch(/process\.env\.URL_SUPABASE_PRODUCTION/);
    for (const fichier of CODE_APPLICATION) {
      const code = sansCommentaires(fichier);
      expect(code, fichier).not.toMatch(/NEXT_PUBLIC_URL_SUPABASE_PRODUCTION/);
      if (/^["']use client["']/m.test(lire(fichier))) {
        expect(code, `${fichier} (navigateur)`).not.toMatch(/lib\/demonstration|URL_SUPABASE_PRODUCTION/);
      }
    }
  });

  it("le bandeau porte le texte demandé ; le layout l'affiche DÈS QU'on n'est pas en production, et rien d'autre ne le pilote", () => {
    expect(fr.Demonstration.bandeau).toBe("Version de démonstration — données fictives");
    const html = renderToStaticMarkup(<BandeauDemonstration texte={fr.Demonstration.bandeau} />);
    expect(html).toContain("Version de démonstration — données fictives");
    const layout = lire("app/layout.tsx");
    expect(layout).toMatch(/enDemonstration\(\)\s*&&\s*<BandeauDemonstration/);
    expect(layout).toMatch(/robots:\s*robotsDeLaPage\(\)/);
    expect(layout).not.toMatch(/enProduction\(\)\s*\?/); // pas de logique inverse à côté : un seul chemin
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
