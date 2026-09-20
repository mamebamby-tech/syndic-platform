import { NextResponse, type NextRequest } from "next/server";
import { creerClientServeur } from "@/lib/supabase/server";

// Connexion par lien : UNIQUEMENT en développement, pour `npm run dev:lien`
// (scripts/dev-lien.ts), qui génère un lien sans envoyer de courriel.
//
// Le produit n'a pas décidé d'offrir la connexion par lien : l'authentification
// est un code à usage unique saisi sur /login. En production cette route
// n'existe pas (404) — elle n'ouvre aucune porte que le produit n'a choisie.
// Supabase émet le jeton de session avec l'horloge de l'authentification ; PostgREST
// le refuse (« JWT issued at future ») si son propre horloge retarde, même d'une
// seconde. Sur un lien, la redirection vers l'accueil enchaînerait aussitôt une
// requête et tomberait sur cette erreur à chaque fois : on attend quelques secondes
// avant de rediriger. Développement seulement (la route n'existe pas en production).
const ATTENTE_HORLOGE_MS = Number(process.env.DEV_LIEN_ATTENTE_MS ?? 3000);

export async function GET(requete: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const { searchParams } = requete.nextUrl;
  const jeton = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const echec = () => NextResponse.redirect(new URL("/login", requete.nextUrl));
  if (!jeton || (type !== "email" && type !== "magiclink")) return echec();

  const supabase = await creerClientServeur();
  const { error } = await supabase.auth.verifyOtp({ token_hash: jeton, type });
  if (error) return echec();

  await new Promise((resolve) => setTimeout(resolve, ATTENTE_HORLOGE_MS));
  return NextResponse.redirect(new URL("/", requete.nextUrl));
}
