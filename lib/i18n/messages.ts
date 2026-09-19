import fr from "@/messages/fr.json";
import { LANGUE_PAR_DEFAUT, type Langue } from "@/lib/i18n/config";

export type Messages = typeof fr;

type Arbre = { [cle: string]: string | Arbre };

function fusionner(base: Arbre, surcharge: Arbre): Arbre {
  const resultat: Arbre = { ...base };
  for (const [cle, valeur] of Object.entries(surcharge)) {
    const existant = resultat[cle];
    resultat[cle] =
      typeof valeur === "object" && typeof existant === "object"
        ? fusionner(existant, valeur)
        : valeur;
  }
  return resultat;
}

// Le français est la langue de référence : une clé absente d'une autre
// langue s'affiche en français, jamais sous forme de clé brute. Une
// traduction incomplète dégrade la lecture, elle ne casse pas un écran
// d'appel de fonds.
export async function chargerMessages(langue: Langue): Promise<Messages> {
  if (langue === LANGUE_PAR_DEFAUT) return fr;
  const propres = (await import(`../../messages/${langue}.json`)).default as Arbre;
  return fusionner(fr, propres) as Messages;
}

// Espaces de noms lus par des composants clients (`"use client"`). Le reste —
// pages serveur, documents, gabarits de notification — n'est jamais envoyé
// au navigateur : sur une connexion irrégulière, chaque octet du HTML compte.
// Un composant client qui lit un espace absent d'ici affiche sa clé brute :
// l'ajouter à cette liste.
const ESPACES_CLIENT = [
  "Connexion",
  "Navigation",
  "Budget",
  "Appels",
  "StatutAppel",
  "AnomalieContact",
  "Parametres",
  "MoyenPaiement",
] as const satisfies readonly (keyof Messages)[];

export function messagesPourLeNavigateur(messages: Messages) {
  return Object.fromEntries(ESPACES_CLIENT.map((espace) => [espace, messages[espace]]));
}
