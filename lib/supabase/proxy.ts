import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database";
import { fetchAvecReprise } from "@/lib/supabase/reprise";
import { lireEnvSupabase } from "@/lib/supabase/env";

// Rafraîchit la session à chaque requête, condition pour que la sécurité
// par ligne dispose toujours d'un auth.uid() à jour côté serveur.
export async function mettreAJourSession(request: NextRequest) {
  let reponse = NextResponse.next({ request });
  const { url, cleAnonyme } = lireEnvSupabase();

  const supabase = createServerClient<Database>(
    url,
    cleAnonyme,
    {
      global: { fetch: fetchAvecReprise() },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesASdefinir) {
          for (const { name, value } of cookiesASdefinir) {
            request.cookies.set(name, value);
          }
          reponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesASdefinir) {
            reponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const estPageConnexion = request.nextUrl.pathname.startsWith("/login");
  const estRouteAuth = request.nextUrl.pathname.startsWith("/auth");

  if (!user && !estPageConnexion && !estRouteAuth) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return reponse;
}
