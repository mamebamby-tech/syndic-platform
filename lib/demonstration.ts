import type { Metadata, MetadataRoute } from "next";

// Mode démonstration : DEMONSTRATION=1, variable SERVEUR (jamais NEXT_PUBLIC_), posée sur
// le déploiement de démonstration seulement — celui qui pointe vers syndic-dev, la base
// fictive. Elle ne se pose JAMAIS sur un déploiement relié à la base réelle : le bandeau
// affirmerait que les données sont fictives.
//
// Lue à chaque appel, pas à l'import : elle se change sans toucher au code, et se teste.
export const enDemonstration = (): boolean => process.env.DEMONSTRATION === "1";

// Ni indexation ni suivi des liens, en démonstration seulement. Hors démonstration
// (production plus tard) : rien n'est imposé ici, la question de l'indexation reste ouverte.
export function robotsDeLaPage(): Metadata["robots"] {
  return enDemonstration() ? { index: false, follow: false } : undefined;
}

// /robots.txt. En démonstration : aucun robot. Sinon : rien n'est interdit par ce fichier.
export function reglesRobots(): MetadataRoute.Robots {
  return enDemonstration()
    ? { rules: { userAgent: "*", disallow: "/" } }
    : { rules: { userAgent: "*", allow: "/" } };
}
