import { type NextRequest } from "next/server";
import { mettreAJourSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return mettreAJourSession(request);
}

// Ce qui SORT du contrôle d'authentification : exactement ceci, et rien d'autre.
//
//   /_next/static/…   fichiers compilés de Next.js
//   /_next/image      optimiseur d'images de Next.js
//   /favicon.ico      icône
//   /robots.txt       lu par les robots, qui n'ont pas de session (app/robots.ts)
//   /<fichier>.png…   un fichier image À LA RACINE (dossier public/) — jamais un segment
//                     de page : /immeubles/x.png reste protégé
//
// Chaque motif est ancré (`$`, ou `/` final) et son point échappé : une exclusion écrite
// comme un simple préfixe laissait sortir /robots.txt/x, /robots.txtx, /robotsAtxt, et un
// motif `.*\.png$` laissait sortir toute page dont un segment finit par une extension
// d'image. Le test tests/proxy-matcher.test.ts échoue si une route de l'application sort
// du matcher sans être dans sa liste des routes publiques.
export const config = {
  matcher: [
    "/((?!_next/static/|_next/image$|favicon\\.ico$|robots\\.txt$|[^/]+\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
