import type { Metadata, MetadataRoute } from "next";

// Le mode PRODUCTION est l'exception ; la DÉMONSTRATION est l'état par défaut.
//
// Le déploiement est en production seulement si NEXT_PUBLIC_SUPABASE_URL (la base à laquelle
// l'application est reliée) est EXACTEMENT égale à URL_SUPABASE_PRODUCTION, variable SERVEUR
// qui porte l'adresse de la base réelle attendue. Dans tous les autres cas — variable absente,
// vide, valeur différente d'un seul caractère — l'application est en démonstration : bandeau
// affiché, indexation interdite.
//
// Un oubli de configuration donne donc une démonstration, jamais un site de production
// indexé. Et une démonstration reliée à syndic-dev ne peut pas passer en production par
// erreur : son URL n'est pas celle qu'on attend.
//
// Comparaison exacte : ni espaces ôtés, ni majuscules ignorées, ni barre finale tolérée. Une
// approximation qui « corrigerait » la valeur pourrait faire passer en production ce qui
// ne l'est pas ; une valeur légèrement fausse retombe sur la démonstration, le bon côté.
//
// Lues à chaque appel (pas à l'import) : testable, et sans état caché.
export function enProduction(): boolean {
  const attendue = process.env.URL_SUPABASE_PRODUCTION;
  const courante = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // « non vide » : deux variables absentes ou vides seraient égales (undefined === undefined,
  // "" === "") et feraient passer en production un déploiement non configuré.
  return typeof attendue === "string" && attendue.trim() !== "" && courante === attendue;
}

export const enDemonstration = (): boolean => !enProduction();

// Ni indexation ni suivi des liens, sauf en production.
export function robotsDeLaPage(): Metadata["robots"] {
  return enDemonstration() ? { index: false, follow: false } : undefined;
}

// /robots.txt. Démonstration : aucun robot. Production : ce fichier n'interdit rien.
export function reglesRobots(): MetadataRoute.Robots {
  return enDemonstration()
    ? { rules: { userAgent: "*", disallow: "/" } }
    : { rules: { userAgent: "*", allow: "/" } };
}
