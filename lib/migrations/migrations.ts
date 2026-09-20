import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Suivi des migrations : ce que le dépôt contient, ce qu'une base a enregistré, et l'écart.
// Ce module est PUR (hors lecture du dossier) : aucune connexion à une base. Les imports
// sont relatifs, sans alias : il est chargé tel quel par Node (scripts/migrations.ts).

export interface MigrationDuDepot {
  version: string;
  nom: string;
  fichier: string;
  sql: string;
  // SHA-256 du fichier : détecte une migration modifiée APRÈS son application.
  empreinte: string;
}

export interface MigrationEnregistree {
  version: string;
  nom: string | null;
  empreinte: string | null;
}

export type StatutMigration =
  // Enregistrée dans l'historique de la base, fichier inchangé.
  | "enregistree"
  // Enregistrée, mais le fichier du dépôt a changé depuis : la base a reçu une autre version.
  | "enregistree_modifiee"
  // Non enregistrée, mais une trace plus récente est présente : appliquée avant le suivi.
  | "deduite"
  | "a_appliquer";

export interface LigneEtat {
  migration: MigrationDuDepot;
  statut: StatutMigration;
  // Le marqueur de la migration : vrai / faux, ou null si elle n'en a pas.
  marqueur: boolean | null;
}

export interface EtatMigrations {
  lignes: LigneEtat[];
  aAppliquer: MigrationDuDepot[];
  // Enregistrées dans la base mais absentes du dépôt.
  orphelines: MigrationEnregistree[];
  avertissements: string[];
  historiqueExiste: boolean;
}

export function lireDepot(dossier: string): MigrationDuDepot[] {
  return readdirSync(dossier)
    .filter((nom) => nom.endsWith(".sql"))
    .map((fichier) => {
      const m = /^(\d{14})_(.+)\.sql$/.exec(fichier);
      if (!m) throw new Error(`Nom de migration invalide : « ${fichier} » (attendu AAAAMMJJHHMMSS_nom.sql).`);
      const sql = readFileSync(join(dossier, fichier), "utf8");
      return {
        version: m[1]!,
        nom: m[2]!,
        fichier,
        sql,
        empreinte: createHash("sha256").update(sql).digest("hex"),
      };
    })
    .sort((a, b) => a.version.localeCompare(b.version));
}

export function calculerEtat(entree: {
  depot: MigrationDuDepot[];
  enregistrees: MigrationEnregistree[];
  historiqueExiste: boolean;
  // version -> la trace de la migration est présente dans la base ; absent = pas de marqueur.
  marqueurs: Record<string, boolean>;
}): EtatMigrations {
  const { depot, enregistrees, historiqueExiste, marqueurs } = entree;
  const parVersion = new Map(enregistrees.map((e) => [e.version, e]));
  const avertissements: string[] = [];

  // Plafond : la trace présente la plus récente. Tout ce qui la précède est présumé appliqué.
  const versionsAvecTrace = depot.filter((m) => marqueurs[m.version] === true).map((m) => m.version);
  const plafond = versionsAvecTrace.length > 0 ? versionsAvecTrace[versionsAvecTrace.length - 1]! : null;
  const derniereEnregistree = enregistrees.map((e) => e.version).sort().at(-1) ?? null;
  const premiereEnregistree = enregistrees.map((e) => e.version).sort()[0] ?? null;

  const lignes: LigneEtat[] = depot.map((migration) => {
    const marqueur = migration.version in marqueurs ? marqueurs[migration.version]! : null;
    const enregistree = parVersion.get(migration.version);
    if (enregistree) {
      const modifiee = enregistree.empreinte !== null && enregistree.empreinte !== migration.empreinte;
      return { migration, statut: modifiee ? "enregistree_modifiee" : "enregistree", marqueur };
    }
    // Déduction : seulement AVANT la première migration enregistrée (la zone d'avant le
    // suivi), ou partout si rien n'est enregistré. Un trou après une migration enregistrée
    // n'est pas de l'avant-suivi : c'est une migration manquante.
    const avantLeSuivi = premiereEnregistree === null || migration.version < premiereEnregistree;
    if (plafond !== null && migration.version <= plafond && avantLeSuivi) {
      return { migration, statut: "deduite", marqueur };
    }
    return { migration, statut: "a_appliquer", marqueur };
  });

  // Incohérences : une trace plus récente présente alors qu'une plus ancienne est absente.
  const tracesAbsentes = depot.filter((m) => marqueurs[m.version] === false);
  for (const absente of tracesAbsentes) {
    const plusRecente = versionsAvecTrace.find((v) => v > absente.version);
    if (plusRecente) {
      avertissements.push(
        `Incohérence : la trace de ${plusRecente} est présente mais celle de ${absente.version} (${absente.nom}) est absente.`,
      );
    }
  }

  const aAppliquer = lignes.filter((l) => l.statut === "a_appliquer").map((l) => l.migration);

  // Une migration à appliquer plus ANCIENNE qu'une migration enregistrée : hors ordre.
  for (const m of aAppliquer) {
    if (derniereEnregistree !== null && m.version < derniereEnregistree) {
      avertissements.push(
        `Hors ordre : ${m.version} (${m.nom}) n'est pas appliquée alors que ${derniereEnregistree} l'est.`,
      );
    }
  }

  for (const l of lignes) {
    if (l.statut === "enregistree_modifiee") {
      avertissements.push(
        `Modifiée après son application : ${l.migration.version} (${l.migration.nom}) — la base a reçu une autre version du fichier.`,
      );
    }
  }

  const versionsDepot = new Set(depot.map((m) => m.version));
  const orphelines = enregistrees.filter((e) => !versionsDepot.has(e.version));
  for (const o of orphelines) {
    avertissements.push(`Enregistrée dans la base mais absente du dépôt : ${o.version}${o.nom ? ` (${o.nom})` : ""}.`);
  }

  return { lignes, aAppliquer, orphelines, avertissements, historiqueExiste };
}

// Migrations qu'on peut appliquer sans risque de désordre : aucune n'est plus ancienne
// qu'une migration déjà enregistrée, aucune incohérence de traces.
export function peutAppliquer(etat: EtatMigrations): { ok: boolean; raisons: string[] } {
  const raisons = etat.avertissements.filter((a) => a.startsWith("Hors ordre") || a.startsWith("Incohérence"));
  if (!etat.historiqueExiste && etat.lignes.some((l) => l.statut === "deduite")) {
    raisons.push("Aucun historique : lancez d'abord l'adoption (npm run db:adopter) pour enregistrer l'état actuel.");
  }
  return { ok: raisons.length === 0, raisons };
}

// Instructions à RELIRE avant d'appliquer sur une base réelle : celles qui détruisent ou
// réécrivent des données. Un décompte, pas un jugement : à lire avec le fichier. Il compte
// aussi les instructions des CORPS de fonctions et de déclencheurs, qui ne s'exécutent pas
// à l'application de la migration mais plus tard : d'où « à relire », pas « dangereux ».
export function instructionsSensibles(sql: string): Record<string, number> {
  const sansCommentaires = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();
  const compter = (motif: RegExp) => (sansCommentaires.match(motif) ?? []).length;
  const decompte: Record<string, number> = {
    "drop (table, colonne, fonction, politique, déclencheur…)": compter(/\bdrop\s+(table|column|schema|function|policy|trigger|constraint|index|type)\b/g),
    "delete from": compter(/\bdelete\s+from\b/g),
    "truncate": compter(/\btruncate\b/g),
    "update … set": compter(/^\s*update\s+\S+(\s+\w+)?\s+set\b/gm),
    "revoke": compter(/\brevoke\b/g),
  };
  return Object.fromEntries(Object.entries(decompte).filter(([, n]) => n > 0));
}

const LIBELLES: Record<StatutMigration, string> = {
  enregistree: "enregistrée",
  enregistree_modifiee: "enregistrée, fichier modifié depuis",
  deduite: "déduite (trace présente dans la base, sans historique)",
  a_appliquer: "À APPLIQUER",
};
const PICTOS: Record<StatutMigration, string> = { enregistree: "✓", enregistree_modifiee: "!", deduite: "~", a_appliquer: "✗" };

export function formaterEtat(etat: EtatMigrations): string[] {
  const largeur = Math.max(...etat.lignes.map((l) => l.migration.nom.length), 10);
  const sortie = etat.lignes.map(
    (l) => `  ${PICTOS[l.statut]} ${l.migration.version}  ${l.migration.nom.padEnd(largeur)}  ${LIBELLES[l.statut]}`,
  );
  sortie.push("");
  const n = etat.aAppliquer.length;
  sortie.push(n === 0 ? "Écart : aucun — la base est à jour." : `Écart : ${n} migration${n > 1 ? "s" : ""} à appliquer.`);
  for (const a of etat.avertissements) sortie.push(`  ⚠ ${a}`);
  return sortie;
}
