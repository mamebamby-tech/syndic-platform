import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

// Le contrôle d'authentification (proxy.ts) ne s'applique qu'aux chemins que son matcher
// retient. Un chemin qui SORT du matcher n'est plus vérifié : ni session rafraîchie, ni
// redirection vers /login. Ce fichier échoue si une route de l'application en sort sans
// être dans la liste ci-dessous — la liste des routes publiques, qui se modifie
// consciemment, jamais par accident.
//
// (La sécurité des données ne repose pas sur le proxy : la sécurité par ligne de la base
// refuse de toute façon les requêtes sans session. Le proxy est la porte, pas le coffre.)

// LES routes publiques : celles qu'un visiteur sans session doit pouvoir atteindre, et qui
// sortent donc du proxy. Ajouter une ligne ici est une décision de sécurité.
const ROUTES_PUBLIQUES = ["/robots.txt"];

// Comme Next.js : le matcher est une expression ancrée sur le chemin entier.
expect(config.matcher).toHaveLength(1);
const MATCHER = new RegExp(`^${config.matcher[0]}$`);
const protege = (chemin: string) => MATCHER.test(chemin);

// --- Les routes de l'application, lues dans app/ -----------------------------------------

const RACINE = "app";
const fichiers = (dossier: string): string[] =>
  readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    return statSync(chemin).isDirectory() ? fichiers(chemin) : [chemin];
  });

// Valeurs de segments dynamiques choisies pour piéger un matcher mal ancré.
const VALEURS = ["abc", "x.png", "photo.webp", "robots.txt", "favicon.ico", "_next", "a.b.c", "0000-uuid"];

function routesDeLApplication(): string[] {
  const routes = new Set<string>();
  for (const fichier of fichiers(RACINE)) {
    const parties = relative(RACINE, fichier).split(sep);
    const nom = parties.pop()!;
    const segments = parties.filter((p) => !/^\(.*\)$/.test(p)); // groupes de routes : absents de l'URL
    let fin: string | null = null;
    if (/^(page|route)\.(tsx|ts|jsx|js)$/.test(nom)) fin = "";
    else if (/^robots\.(ts|js)$/.test(nom)) fin = "robots.txt";
    else if (/^sitemap\.(ts|js)$/.test(nom)) fin = "sitemap.xml";
    else if (/^(icon|apple-icon|opengraph-image|twitter-image)\d*\.(ts|tsx|js)$/.test(nom)) fin = nom.replace(/\.(ts|tsx|js)$/, "");
    else if (/^manifest\.(ts|js)$/.test(nom)) fin = "manifest.webmanifest";
    if (fin === null) continue;
    const modele = [...segments, ...(fin ? [fin] : [])];
    // Chaque segment dynamique prend chaque valeur piège (produit limité : au plus deux).
    let chemins: string[][] = [[]];
    for (const seg of modele) {
      const dynamique = /^\[\[?(\.\.\.)?[^\]]+\]?\]$/.test(seg);
      chemins = chemins.flatMap((c) => (dynamique ? VALEURS.map((v) => [...c, v]) : [[...c, seg]]));
    }
    for (const c of chemins) routes.add("/" + c.join("/"));
  }
  return [...routes].sort();
}

describe("le matcher du proxy d'authentification", () => {
  const routes = routesDeLApplication();

  it("l'application a bien des routes à examiner (le test ne passe pas à vide)", () => {
    expect(routes.length).toBeGreaterThan(20);
    for (const attendue of ["/", "/login", "/auth/confirmation", "/immeubles/abc", "/immeubles/abc/appels", "/immeubles/abc/proprietaires/abc", "/robots.txt"]) {
      expect(routes, attendue).toContain(attendue);
    }
  });

  it("toute route de l'application passe par le proxy, sauf les routes publiques listées", () => {
    const sorties = routes.filter((r) => !protege(r));
    expect(sorties).toEqual(ROUTES_PUBLIQUES);
  });

  it("chaque route publique listée sort bien du matcher (la liste ne ment pas)", () => {
    for (const r of ROUTES_PUBLIQUES) expect(protege(r), r).toBe(false);
  });

  it("une valeur de segment dynamique ne fait jamais sortir une page du proxy", () => {
    for (const valeur of VALEURS) {
      for (const chemin of [
        `/immeubles/${valeur}`,
        `/immeubles/${valeur}/appels`,
        `/immeubles/${valeur}/proprietaires/${valeur}`,
      ]) {
        expect(protege(chemin), chemin).toBe(true);
      }
    }
  });

  it("aucune route d'API ne sort du proxy (y compris celles qui n'existent pas encore)", () => {
    for (const chemin of ["/api", "/api/immeubles", "/api/immeubles/abc/paiements", "/api/webhook", "/api/x.png", "/api/robots.txt"]) {
      expect(protege(chemin), chemin).toBe(true);
    }
    // Une route d'API future qui devrait être publique (un webhook de paiement, signé) est
    // ajoutée à ROUTES_PUBLIQUES et exclue du matcher : ce test échouera, et forcera la décision.
    expect(routes.filter((r) => r.startsWith("/api"))).toEqual([]);
  });

  it("les exclusions sont ancrées : aucun chemin qui ressemble seulement à une exclusion n'en sort", () => {
    for (const chemin of [
      "/robots.txt/x", "/robots.txtx", "/robotsAtxt", "/robots.txt-secret", "/immeubles/robots.txt",
      "/favicon.icoX", "/faviconXico", "/favicon.ico/x",
      "/_next/staticX", "/_next/imagex", "/_next/image/x",
      "/immeubles/x.png", "/immeubles/abc/proprietaires/x.webp", "/a/b.svg",
    ]) {
      expect(protege(chemin), chemin).toBe(true);
    }
  });

  it("les seules exclusions : fichiers compilés, optimiseur d'images, favicon, robots.txt, images à la racine", () => {
    for (const chemin of ["/_next/static/chunks/a.js", "/_next/static/", "/_next/image", "/favicon.ico", "/robots.txt", "/logo.png", "/logo.svg", "/photo.jpeg"]) {
      expect(protege(chemin), chemin).toBe(false);
    }
  });
});
