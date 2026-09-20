// Arguments de `npm run dev:lien`, et adresse du lien produit. Pur : aucune connexion, aucun
// accès à une base — importé par scripts/dev-lien.ts et testé sans réseau.

export const UTILISATION =
  "Utilisation : npm run dev:lien -- <adresse électronique> [--retour=<adresse du site>]";

export class ErreurUtilisation extends Error {}

export interface Arguments {
  email: string;
  // L'adresse de retour demandée par --retour ; null si l'option est absente.
  retour: string | null;
}

// Une adresse de retour est l'ADRESSE D'UN SITE : http ou https, un hôte, éventuellement un
// port. Rien d'autre : ni identifiants, ni chemin, ni paramètres, ni ancre — le lien
// ajoute lui-même son chemin (/auth/confirmation). Renvoie l'adresse normalisée, sans barre finale.
export function normaliserRetour(valeur: string): string {
  if (valeur.trim() === "") throw new ErreurUtilisation("--retour est vide : indiquez l'adresse du site.");
  let url: URL;
  try {
    url = new URL(valeur);
  } catch {
    throw new ErreurUtilisation(`--retour : « ${valeur} » n'est pas une adresse (exemple : http://192.168.1.20:3000).`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ErreurUtilisation(`--retour : seules les adresses http et https sont acceptées (reçu : « ${url.protocol} »).`);
  }
  if (url.username || url.password) {
    throw new ErreurUtilisation("--retour : l'adresse ne doit contenir ni identifiant ni mot de passe.");
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new ErreurUtilisation(
      "--retour : indiquez l'adresse du site seule, sans chemin, paramètres ni ancre (le lien ajoute /auth/confirmation).",
    );
  }
  return url.origin;
}

// `env` : celui du processus. npm absorbe `--retour=…` quand il n'est pas précédé de `--`
// (`npm run dev:lien x --retour=y`) et le range dans `npm_config_retour` au lieu de le
// transmettre : sans ce contrôle, le script produirait SILENCIEUSEMENT un lien vers
// localhost, l'adresse que l'on voulait éviter.
export function lireArguments(argv: string[], env: Record<string, string | undefined> = {}): Arguments {
  let retour: string | null = null;
  const positionnels: string[] = [];

  for (const argument of argv) {
    if (argument.startsWith("--retour=")) {
      if (retour !== null) throw new ErreurUtilisation("--retour est donné deux fois.");
      retour = normaliserRetour(argument.slice("--retour=".length));
    } else if (argument === "--retour") {
      throw new ErreurUtilisation("--retour attend une valeur : --retour=<adresse du site>.");
    } else if (argument.startsWith("--")) {
      throw new ErreurUtilisation(`Option inconnue : ${argument.split("=")[0]}`);
    } else {
      positionnels.push(argument);
    }
  }

  if (retour === null && env.npm_config_retour !== undefined) {
    throw new ErreurUtilisation(
      "npm a absorbé --retour au lieu de le transmettre. Ajoutez « -- » avant les arguments :\n" +
        "  npm run dev:lien -- <adresse électronique> --retour=<adresse du site>",
    );
  }

  const email = positionnels[0]?.trim();
  if (!email) throw new ErreurUtilisation(UTILISATION);
  if (positionnels.length > 1) {
    throw new ErreurUtilisation(`Un seul compte à la fois (reçu : ${positionnels.length} arguments).\n${UTILISATION}`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ErreurUtilisation(`Adresse invalide : « ${email} ».\n${UTILISATION}`);
  }
  return { email, retour };
}

// L'adresse du site où le lien ramène : --retour, sinon NEXT_PUBLIC_SITE_URL, sinon localhost.
// Sans --retour, c'est exactement le comportement d'avant.
export function adresseDuSite(retour: string | null, siteConfigure: string | undefined): string {
  return retour ?? (siteConfigure || "http://localhost:3000").replace(/\/$/, "");
}

export function adresseDuLien(site: string, jetonHache: string): string {
  return `${site}/auth/confirmation?token_hash=${encodeURIComponent(jetonHache)}&type=email`;
}

// Une adresse qui n'est ni cette machine ni un réseau privé : un lien qui y mène partirait
// sur Internet. Le jeton est à usage unique et pour un compte de syndic-dev, mais l'auteur
// doit le voir.
export function estAdresseLocale(site: string): boolean {
  const hote = new URL(site).hostname.replace(/^\[|\]$/g, "");
  if (hote === "localhost" || hote.endsWith(".local") || hote === "::1") return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(hote);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
