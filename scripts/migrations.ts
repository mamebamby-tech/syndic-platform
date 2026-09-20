// npm run db:etat | db:adopter | db:appliquer  [-- --cible=dev|reel] [--essai]
//
//   etat       Affiche l'écart entre le dépôt et une base. LECTURE SEULE : transaction
//              `read only`, aucun `insert`, aucun `create`. Sans effet sur la base.
//   adopter    Sur une base sans historique : enregistre comme appliquées les migrations
//              dont la trace est déjà présente. N'exécute aucun SQL de migration.
//   appliquer  Applique les migrations manquantes, dans l'ordre, chacune dans sa
//              transaction avec son enregistrement. `--essai` : montre ce qui serait fait,
//              n'exécute rien.
//
// Cible : `--cible=dev` (défaut) — syndic-dev, derrière le MÊME garde-fou que les tests ;
//         `--cible=reel` — la base réelle, lue dans .env.reel. Sur la base réelle,
//         `adopter` et `appliquer` ÉCRIVENT : ils exigent un terminal interactif et que
//         vous tapiez la phrase de confirmation, qui nomme l'hôte et le nombre de
//         migrations. Il n'existe aucune option pour passer outre.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parse } from "dotenv";
import { Client } from "pg";
import { EnvironnementDeTestInterdit, garderEnvironnement, hoteDe } from "../tests/garde-environnement.ts";
import { adopter, appliquerUne, lireEtat, verrouiller } from "../lib/migrations/base.ts";
import {
  formaterEtat,
  instructionsSensibles,
  lireDepot,
  peutAppliquer,
  type MigrationDuDepot,
} from "../lib/migrations/migrations.ts";

const UTILISATION =
  "Utilisation : node scripts/migrations.ts <etat|adopter|appliquer> [--cible=dev|reel] [--essai]";

function arreter(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

const [commande, ...options] = process.argv.slice(2);
if (!commande || !["etat", "adopter", "appliquer"].includes(commande)) arreter(UTILISATION, 2);
const cibleDemandee = options.find((o) => o.startsWith("--cible="))?.slice("--cible=".length) ?? "dev";
if (cibleDemandee !== "dev" && cibleDemandee !== "reel") arreter(`Cible inconnue : « ${cibleDemandee} ».\n${UTILISATION}`, 2);
const essai = options.includes("--essai");
const inconnues = options.filter((o) => !o.startsWith("--cible=") && o !== "--essai");
if (inconnues.length > 0) arreter(`Option inconnue : ${inconnues.join(" ")}\n${UTILISATION}`, 2);
if (essai && commande !== "appliquer") arreter("--essai ne s'applique qu'à « appliquer ».", 2);

// 1. La cible. Rien n'est ouvert avant qu'elle soit prouvée.
let url: string;
if (cibleDemandee === "dev") {
  try {
    await garderEnvironnement();
  } catch (erreur) {
    if (erreur instanceof EnvironnementDeTestInterdit) {
      arreter(erreur.message.replace("TESTS ARRÊTÉS", "COMMANDE REFUSÉE (--cible=dev ne s'exécute que sur syndic-dev)"));
    }
    throw erreur;
  }
  url = process.env.DATABASE_URL!;
} else {
  // La base réelle : .env.reel, lu ici et nulle part ailleurs dans le code exécuté par
  // l'application ou les tests. Analysé, jamais copié dans process.env.
  let reel: Record<string, string>;
  try {
    reel = parse(readFileSync(".env.reel"));
  } catch {
    arreter("--cible=reel : .env.reel est introuvable ou illisible. Rien n'a été fait.");
  }
  if (!reel.DATABASE_URL?.trim()) arreter("--cible=reel : DATABASE_URL est vide dans .env.reel. Rien n'a été fait.");
  url = reel.DATABASE_URL;
  let dev: string | undefined;
  try {
    dev = parse(readFileSync(".env.local")).DATABASE_URL;
  } catch {
    dev = undefined;
  }
  if (dev && hoteDe(dev) === hoteDe(url)) {
    arreter("--cible=reel : .env.reel désigne le même hôte que .env.local (syndic-dev). Ce n'est pas la base réelle. Rien n'a été fait.");
  }
}
const hote = hoteDe(url) ?? "hôte inconnu";
const reelle = cibleDemandee === "reel";
console.log(`\nCible : ${reelle ? "BASE RÉELLE" : "syndic-dev"} (${hote})`);

const depot = lireDepot("supabase/migrations");
const client = new Client({ connectionString: url });
try {
  await client.connect();
} catch (erreur) {
  arreter(`Connexion impossible à ${hote} : ${erreur instanceof Error ? erreur.message : String(erreur)}\nRien n'a été fait.`);
}

async function confirmer(phrase: string): Promise<void> {
  if (!process.stdin.isTTY) {
    arreter("Base réelle : une confirmation interactive est exigée, et l'entrée n'est pas un terminal. Rien n'a été fait.");
  }
  const lecteur = createInterface({ input: process.stdin, output: process.stdout });
  const reponse = (await lecteur.question(`\nPour confirmer, tapez exactement :\n  ${phrase}\n> `)).trim();
  lecteur.close();
  if (reponse !== phrase) arreter("Confirmation différente : annulé. Rien n'a été fait.");
}

function montrerSensibles(liste: MigrationDuDepot[]): void {
  for (const m of liste) {
    const sensibles = instructionsSensibles(m.sql);
    const detail = Object.entries(sensibles).map(([k, n]) => `${k} ×${n}`);
    console.log(`  → ${m.fichier}${detail.length ? `\n      à relire : ${detail.join(", ")}` : ""}`);
  }
}

try {
  const etat = await lireEtat(client, depot);
  console.log("");
  for (const ligne of formaterEtat(etat)) console.log(ligne);

  if (commande === "etat") {
    if (!etat.historiqueExiste) {
      console.log("\nAucun historique dans cette base : `adopter` enregistrera les migrations déjà appliquées.");
    }
    process.exit(0);
  }

  // --essai : lecture seule, sur n'importe quelle cible. Sort AVANT le verrou et avant tout
  // refus, pour qu'on puisse relire ce qui serait appliqué même sur une base sans historique.
  if (commande === "appliquer" && essai) {
    const verdict = peutAppliquer(etat);
    if (etat.aAppliquer.length === 0) {
      console.log("\nRien à appliquer.");
    } else {
      console.log(`\nÀ appliquer, dans cet ordre :`);
      montrerSensibles(etat.aAppliquer);
    }
    for (const r of verdict.raisons) console.log(`\n  ⚠ ${r}`);
    console.log("\n--essai : rien n'a été exécuté.");
    process.exit(0);
  }

  if (!(await verrouiller(client))) arreter("Une autre exécution est en cours sur cette base. Rien n'a été fait.");

  if (commande === "adopter") {
    const deduites = etat.lignes.filter((l) => l.statut === "deduite").map((l) => l.migration);
    if (deduites.length === 0) {
      console.log(etat.historiqueExiste ? "\nRien à adopter." : "\nRien à adopter : aucune trace de migration dans cette base.");
      process.exit(0);
    }
    console.log(`\nAdoption : ${deduites.length} migration(s) enregistrée(s) comme déjà appliquées (aucun SQL de migration exécuté).`);
    if (reelle) await confirmer(`ADOPTER ${deduites.length} MIGRATIONS SUR LA BASE REELLE ${hote}`);
    await adopter(client, deduites);
    console.log("Historique en place.");
    process.exit(0);
  }

  // appliquer
  const verdict = peutAppliquer(etat);
  if (!verdict.ok) {
    for (const r of verdict.raisons) console.error(`✗ ${r}`);
    arreter("\nApplication refusée : l'état de la base demande une décision humaine. Rien n'a été fait.");
  }
  if (etat.aAppliquer.length === 0) {
    console.log("\nRien à appliquer.");
    process.exit(0);
  }
  console.log(`\nÀ appliquer, dans cet ordre :`);
  montrerSensibles(etat.aAppliquer);
  if (reelle) await confirmer(`APPLIQUER ${etat.aAppliquer.length} MIGRATIONS SUR LA BASE REELLE ${hote}`);
  for (const m of etat.aAppliquer) {
    try {
      await appliquerUne(client, m);
      console.log(`✓ ${m.fichier}`);
    } catch (erreur) {
      console.error(`✗ ${m.fichier} : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
      arreter("Arrêt à la première erreur : cette migration est annulée, les suivantes ne sont pas tentées.");
    }
  }
  console.log("\nBase à jour.");
} finally {
  await client.end().catch(() => undefined);
}
