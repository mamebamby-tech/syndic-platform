import { NextResponse, type NextRequest } from "next/server";
import { creerClientServeur } from "@/lib/supabase/server";

// Connexion par lien : UNIQUEMENT en développement, pour `npm run dev:lien`
// (scripts/dev-lien.ts), qui génère un lien sans envoyer de courriel.
//
// Le produit n'a pas décidé d'offrir la connexion par lien : l'authentification
// est un code à usage unique saisi sur /login. En production cette route
// n'existe pas (404) — elle n'ouvre aucune porte que le produit n'a choisie.
// Le décalage d'horloge (« JWT issued at future ») n'est pas traité ici : il l'est dans
// le client serveur (lib/supabase/reprise.ts), donc identiquement sur la connexion par code.

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

  return NextResponse.redirect(new URL("/", requete.nextUrl));
}
