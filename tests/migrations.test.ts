import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connecter } from "./pg";
import { adopter, appliquerUne, lireEtat } from "@/lib/migrations/base";
import { MARQUEURS, SANS_MARQUEUR, VERSION_DE_REFERENCE } from "@/lib/migrations/marqueurs";
import {
  calculerEtat,
  formaterEtat,
  instructionsSensibles,
  lireDepot,
  peutAppliquer,
  type MigrationDuDepot,
} from "@/lib/migrations/migrations";

// Suivi des migrations : le calcul de l'écart (pur), la couche base (contre syndic-dev,
// en lecture), et l'ordre des garde-fous du script (par lecture du source).

const migration = (version: string, sql = "select 1;"): MigrationDuDepot => ({
  version,
  nom: `m${version.slice(-2)}`,
  fichier: `${version}_m${version.slice(-2)}.sql`,
  sql,
  empreinte: `sha-${sql}`,
});
const depot = ["20260101000000", "20260102000000", "20260103000000", "20260104000000"].map((v) => migration(v));

describe("calculerEtat — ce qui reste à appliquer", () => {
  it("base sans historique : ce qui précède la dernière trace est déduit, le reste est à appliquer", () => {
    const etat = calculerEtat({
      depot,
      enregistrees: [],
      historiqueExiste: false,
      marqueurs: { "20260101000000": true, "20260102000000": true, "20260103000000": false, "20260104000000": false },
    });
    expect(etat.lignes.map((l) => l.statut)).toEqual(["deduite", "deduite", "a_appliquer", "a_appliquer"]);
    expect(etat.aAppliquer.map((m) => m.version)).toEqual(["20260103000000", "20260104000000"]);
    expect(etat.avertissements).toEqual([]);
  });

  it("une migration SANS trace propre est déduite quand une plus récente est présente", () => {
    const etat = calculerEtat({
      depot,
      enregistrees: [],
      historiqueExiste: false,
      marqueurs: { "20260101000000": true, "20260103000000": true }, // 0102 : pas de marqueur
    });
    expect(etat.lignes[1]!.statut).toBe("deduite");
    expect(etat.lignes[1]!.marqueur).toBeNull();
    expect(etat.aAppliquer.map((m) => m.version)).toEqual(["20260104000000"]);
  });

  it("aucune trace nulle part : tout est à appliquer (base vierge)", () => {
    const etat = calculerEtat({
      depot,
      enregistrees: [],
      historiqueExiste: false,
      marqueurs: Object.fromEntries(depot.map((m) => [m.version, false])),
    });
    expect(etat.aAppliquer).toHaveLength(4);
  });

  it("avec historique : les enregistrées sont à jour, une nouvelle est à appliquer", () => {
    const etat = calculerEtat({
      depot,
      enregistrees: depot.slice(0, 3).map((m) => ({ version: m.version, nom: m.nom, empreinte: m.empreinte })),
      historiqueExiste: true,
      marqueurs: {},
    });
    expect(etat.lignes.map((l) => l.statut)).toEqual(["enregistree", "enregistree", "enregistree", "a_appliquer"]);
    expect(etat.avertissements).toEqual([]);
    expect(peutAppliquer(etat).ok).toBe(true);
  });

  it("un historique partiel n'est jamais complété par déduction : un trou est une migration manquante", () => {
    const etat = calculerEtat({
      depot,
      // 0102 manque, 0103 est enregistrée ; les traces de 0102 sont vraies (peu importe)
      enregistrees: [depot[0]!, depot[2]!].map((m) => ({ version: m.version, nom: m.nom, empreinte: m.empreinte })),
      historiqueExiste: true,
      marqueurs: { "20260102000000": true, "20260104000000": true },
    });
    expect(etat.lignes[1]!.statut).toBe("a_appliquer");
    expect(etat.avertissements.some((a) => a.startsWith("Hors ordre") && a.includes("20260102000000"))).toBe(true);
    expect(peutAppliquer(etat).ok).toBe(false);
  });

  it("fichier modifié après son application : signalé, jamais réappliqué", () => {
    const modifiee = { ...depot[1]!, sql: "select 2;", empreinte: "autre" };
    const etat = calculerEtat({
      depot: [depot[0]!, modifiee],
      enregistrees: depot.slice(0, 2).map((m) => ({ version: m.version, nom: m.nom, empreinte: m.empreinte })),
      historiqueExiste: true,
      marqueurs: {},
    });
    expect(etat.lignes[1]!.statut).toBe("enregistree_modifiee");
    expect(etat.aAppliquer).toEqual([]);
    expect(etat.avertissements.join("\n")).toMatch(/Modifiée après son application : 20260102000000/);
  });

  it("une migration adoptée (empreinte inconnue) n'est pas déclarée modifiée", () => {
    const etat = calculerEtat({
      depot: [depot[0]!],
      enregistrees: [{ version: depot[0]!.version, nom: "m00", empreinte: null }],
      historiqueExiste: true,
      marqueurs: {},
    });
    expect(etat.lignes[0]!.statut).toBe("enregistree");
  });

  it("enregistrée dans la base mais absente du dépôt : signalée", () => {
    const etat = calculerEtat({
      depot: [depot[0]!],
      enregistrees: [
        { version: depot[0]!.version, nom: "m00", empreinte: null },
        { version: "20250101000000", nom: "fantome", empreinte: null },
      ],
      historiqueExiste: true,
      marqueurs: {},
    });
    expect(etat.orphelines.map((o) => o.version)).toEqual(["20250101000000"]);
    expect(etat.avertissements.join("\n")).toMatch(/absente du dépôt : 20250101000000/);
  });

  it("trace récente présente alors qu'une plus ancienne manque : incohérence, application refusée", () => {
    const etat = calculerEtat({
      depot,
      enregistrees: [],
      historiqueExiste: false,
      marqueurs: { "20260101000000": true, "20260102000000": false, "20260103000000": true },
    });
    expect(etat.avertissements.join("\n")).toMatch(/Incohérence : la trace de 20260103000000 est présente mais celle de 20260102000000/);
    expect(peutAppliquer(etat).ok).toBe(false);
  });

  it("sans historique mais avec des migrations déduites : l'adoption doit précéder l'application", () => {
    const etat = calculerEtat({
      depot,
      enregistrees: [],
      historiqueExiste: false,
      marqueurs: { "20260101000000": true, "20260102000000": false, "20260103000000": false, "20260104000000": false },
    });
    const verdict = peutAppliquer(etat);
    expect(verdict.ok).toBe(false);
    expect(verdict.raisons.join("\n")).toMatch(/adoption/);
  });

  it("l'affichage nomme l'écart", () => {
    const etat = calculerEtat({
      depot,
      enregistrees: [],
      historiqueExiste: false,
      marqueurs: { "20260101000000": true, "20260102000000": false, "20260103000000": false, "20260104000000": false },
    });
    const texte = formaterEtat(etat).join("\n");
    expect(texte).toMatch(/Écart : 3 migrations à appliquer/);
    expect(texte).toMatch(/✗ 20260102000000/);
  });
});

describe("instructionsSensibles — à relire avant la base réelle", () => {
  it("compte les instructions destructrices, ignore les commentaires", () => {
    const sql = `-- drop table fantome;\nalter table t drop column c;\ndrop policy p on t;\ndelete from t where x;\ntruncate t;\n  update t set a = 1;\nrevoke all on t from public;`;
    expect(instructionsSensibles(sql)).toEqual({
      "drop (table, colonne, fonction, politique, déclencheur…)": 2,
      "delete from": 1,
      truncate: 1,
      "update … set": 1,
      revoke: 1,
    });
  });
  it("une migration sans rien de sensible ne renvoie rien", () => {
    expect(instructionsSensibles("create table t (id int);")).toEqual({});
  });
});

describe("le dépôt", () => {
  const reel = lireDepot("supabase/migrations");

  it("les versions sont uniques, croissantes, et au format AAAAMMJJHHMMSS", () => {
    const versions = reel.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toEqual([...versions].sort());
    expect(versions.length).toBeGreaterThan(0);
  });

  it("chaque migration existante a un marqueur, ou une raison écrite de ne pas en avoir", () => {
    for (const m of reel.filter((m) => m.version <= VERSION_DE_REFERENCE)) {
      expect(m.version in MARQUEURS || m.version in SANS_MARQUEUR, m.fichier).toBe(true);
    }
  });

  it("aucun marqueur ne vise une migration inexistante, ni postérieure à la référence", () => {
    const versions = new Set(reel.map((m) => m.version));
    for (const v of [...Object.keys(MARQUEURS), ...Object.keys(SANS_MARQUEUR)]) {
      expect(versions.has(v), v).toBe(true);
      expect(v <= VERSION_DE_REFERENCE, v).toBe(true);
    }
  });

  it("les marqueurs ne lisent que le catalogue : aucune table de données", () => {
    for (const [version, expression] of Object.entries(MARQUEURS)) {
      expect(expression, version).not.toMatch(/\b(insert|update|delete|drop|create|alter)\b/i);
      // Les seules « from » permises visent le catalogue.
      for (const [, source] of expression.matchAll(/\bfrom\s+([\w.]+)/gi)) {
        expect(source, version).toMatch(/^(pg_policies|information_schema\.\w+)$/);
      }
    }
  });
});

describe("couche base — contre syndic-dev", () => {
  let client: Client;
  const reel = lireDepot("supabase/migrations");

  beforeAll(async () => {
    client = await connecter();
  });
  afterAll(async () => {
    await client.end();
  });

  it("toutes les traces des migrations existantes sont présentes sur syndic-dev", async () => {
    const etat = await lireEtat(client, reel);
    const absentes = etat.lignes.filter((l) => l.marqueur === false).map((l) => l.migration.fichier);
    expect(absentes, "marqueur faux sur une base où tout est appliqué : marqueur ou base à corriger").toEqual([]);
  });

  it("syndic-dev est à jour : aucune migration du dépôt n'y manque", async () => {
    const etat = await lireEtat(client, reel);
    expect(etat.aAppliquer.map((m) => m.fichier), "npm run db:appliquer").toEqual([]);
    expect(etat.avertissements).toEqual([]);
  });

  it("lireEtat ne peut rien écrire : la transaction est en lecture seule et est annulée", async () => {
    await lireEtat(client, reel);
    // Rien ne reste ouvert : une transaction normale s'ouvre et se ferme.
    await client.query("begin");
    await client.query("rollback");
  });
});

describe("couche base — écriture (client simulé)", () => {
  function simule(echec?: RegExp) {
    const requetes: string[] = [];
    const client = {
      query: async (sql: string) => {
        requetes.push(sql.trim().split("\n")[0]!.trim());
        if (echec?.test(sql)) throw new Error("échec simulé");
        return { rows: [] };
      },
    } as unknown as Client;
    return { client, requetes };
  }
  const m = migration("20260201000000", "select 'sql-de-la-migration';");

  it("appliquerUne : la migration et son enregistrement sont dans la même transaction", async () => {
    const { client, requetes } = simule();
    await appliquerUne(client, m);
    expect(requetes[0]).toBe("begin");
    expect(requetes.at(-1)).toBe("commit");
    const ordre = requetes.findIndex((r) => r.includes("sql-de-la-migration"));
    const enregistrement = requetes.findIndex((r) => r.startsWith("insert into supabase_migrations"));
    expect(ordre).toBeGreaterThan(0);
    expect(enregistrement).toBeGreaterThan(ordre);
  });

  it("appliquerUne : si la migration échoue, rollback et rien n'est enregistré", async () => {
    const { client, requetes } = simule(/sql-de-la-migration/);
    await expect(appliquerUne(client, m)).rejects.toThrow("échec simulé");
    expect(requetes.at(-1)).toBe("rollback");
    expect(requetes.some((r) => r.startsWith("insert into supabase_migrations"))).toBe(false);
    expect(requetes).not.toContain("commit");
  });

  it("adopter : enregistre sans exécuter le SQL des migrations", async () => {
    const { client, requetes } = simule();
    await adopter(client, [m]);
    expect(requetes.some((r) => r.includes("sql-de-la-migration"))).toBe(false);
    expect(requetes.filter((r) => r.startsWith("insert into supabase_migrations"))).toHaveLength(1);
    expect(requetes.at(-1)).toBe("commit");
  });
});

describe("scripts/migrations.ts — les garde-fous, dans l'ordre", () => {
  const source = readFileSync("scripts/migrations.ts", "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("sur syndic-dev, le garde-fou des tests précède toute connexion", () => {
    expect(source.indexOf("garderEnvironnement()")).toBeGreaterThan(0);
    expect(source.indexOf("garderEnvironnement()")).toBeLessThan(source.search(/new\s+Client\s*\(/));
  });

  it("sur la base réelle, chaque écriture est précédée de la confirmation tapée", () => {
    expect(source).toMatch(/if \(reelle\) await confirmer\(`ADOPTER/);
    expect(source).toMatch(/if \(reelle\) await confirmer\(`APPLIQUER/);
    expect(source.indexOf("await confirmer(`ADOPTER")).toBeLessThan(source.indexOf("await adopter(client"));
    expect(source.indexOf("await confirmer(`APPLIQUER")).toBeLessThan(source.indexOf("await appliquerUne(client"));
  });

  it("la confirmation exige un terminal, et aucune option ne la contourne", () => {
    expect(source).toMatch(/process\.stdin\.isTTY/);
    expect(source).not.toMatch(/--(oui|yes|force|confirmer)/i);
  });

  it("--essai sort avant le verrou et avant toute exécution : lecture seule, même sans historique", () => {
    const essai = source.indexOf('commande === "appliquer" && essai');
    expect(essai).toBeGreaterThan(0);
    expect(essai).toBeLessThan(source.indexOf("await verrouiller("));
    expect(essai).toBeLessThan(source.indexOf("await appliquerUne(client"));
    expect(essai).toBeLessThan(source.indexOf("await adopter(client"));
  });

  it("l'état (lecture) ne dépend d'aucune écriture : il sort avant le verrou", () => {
    expect(source.indexOf('if (commande === "etat")')).toBeLessThan(source.indexOf("await verrouiller("));
  });

  it("la couche de lecture est en lecture seule et n'écrit rien", () => {
    const base = readFileSync("lib/migrations/base.ts", "utf8");
    const lecture = base.slice(base.indexOf("export async function lireEtat"), base.indexOf("// ÉCRITURES"));
    expect(lecture).toMatch(/begin read only/);
    expect(lecture).toMatch(/rollback/);
    expect(lecture).not.toMatch(/\b(insert into|create table|create schema|alter table|drop )/i);
  });
});
