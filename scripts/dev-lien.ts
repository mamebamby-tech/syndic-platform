// npm run dev:lien <email>
//
// Génère un lien de connexion à usage unique pour un compte EXISTANT de
// syndic-dev, l'affiche dans le terminal, et n'envoie AUCUN courriel (API
// d'administration `generateLink`, pas `signInWithOtp`). Pour tester l'application
// sous l'identité de n'importe quel membre sans attendre un code par courriel.
//
// Il refuse de s'exécuter si la base cible n'est pas syndic-dev, avec le MÊME
// garde-fou que la suite de tests (tests/garde-environnement.ts) : URL différente
// de celle des clés réelles (.env.reel), présence de « SCI ALIZE », aucune adresse
// hors example.*. Il ne lit que .env.local.
//
// Le lien passe par /auth/confirmation, route qui n'existe qu'en développement (`next dev`).
//
// Option : --retour=<adresse du site> fixe l'adresse où le lien ramène (un téléphone sur le
// réseau local, un tunnel vers `next dev`). Sans elle : NEXT_PUBLIC_SITE_URL, sinon localhost.
// npm exige `--` avant elle : npm run dev:lien -- <adresse électronique> --retour=<adresse>.
// Le garde-fou ci-dessus s'applique à l'identique : --retour ne change JAMAIS la base visée.
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { EnvironnementDeTestInterdit, garderEnvironnement } from "../tests/garde-environnement.ts";
import {
  adresseDuLien,
  adresseDuSite,
  ErreurUtilisation,
  estAdresseLocale,
  lireArguments,
} from "./dev-lien-options.ts";

function arreter(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

let email: string;
let retour: string | null;
try {
  ({ email, retour } = lireArguments(process.argv.slice(2), process.env));
} catch (erreur) {
  if (erreur instanceof ErreurUtilisation) arreter(erreur.message, 2);
  throw erreur;
}

// 1. Le garde-fou, AVANT tout : rien n'est fait tant que la cible n'est pas
// prouvée être syndic-dev.
try {
  await garderEnvironnement();
} catch (erreur) {
  if (erreur instanceof EnvironnementDeTestInterdit) {
    arreter(erreur.message.replace("TESTS ARRÊTÉS", "COMMANDE REFUSÉE (dev:lien ne s'exécute que sur syndic-dev)"));
  }
  throw erreur;
}

const urlApi = process.env.NEXT_PUBLIC_SUPABASE_URL;
const cleService = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!urlApi || !cleService) {
  arreter("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être renseignées dans .env.local.");
}

// 2. Le compte doit exister : `generateLink` en créerait un pour une adresse
// inconnue, et une faute de frappe fabriquerait un compte fantôme.
const base = new Client({ connectionString: process.env.DATABASE_URL });
await base.connect();
let existe: boolean;
try {
  const { rows } = await base.query(`select 1 from auth.users where lower(email) = lower($1)`, [email]);
  existe = rows.length > 0;
} finally {
  await base.end();
}
if (!existe) arreter(`Aucun compte « ${email} » sur syndic-dev : créez-le d'abord (rien n'a été créé).`);

// 3. Le lien. Aucun courriel : generateLink renvoie le jeton, il ne l'envoie pas.
const admin = createClient(urlApi, cleService, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
if (error || !data.properties?.hashed_token) {
  arreter(`Génération du lien impossible : ${error?.message ?? "réponse sans jeton"}`);
}

const site = adresseDuSite(retour, process.env.NEXT_PUBLIC_SITE_URL);
const lien = adresseDuLien(site, data.properties.hashed_token);

console.log(`\nLien de connexion pour ${email} (syndic-dev, aucun courriel envoyé) :\n\n  ${lien}\n`);
console.log(`Adresse de retour : ${site}${retour ? " (option --retour)" : ""}`);
if (retour && !estAdresseLocale(site)) {
  console.log(
    "⚠ Cette adresse n'est ni cette machine ni un réseau privé. La route /auth/confirmation n'existe qu'en\n" +
      "  développement : sur un déploiement (Vercel), elle répond 404. Le lien ne fonctionne que vers un `next dev`.",
  );
}
console.log("À usage unique, il expire rapidement. Il faut que `npm run dev` tourne sur " + site + ".\n");
