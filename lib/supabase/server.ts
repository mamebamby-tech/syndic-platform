import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database";
import { fetchAvecReprise } from "@/lib/supabase/reprise";

// Client Supabase pour Server Components et Server Actions.
// Respecte la sécurité par ligne : jamais la clé de service ici.
export async function creerClientServeur() {
  const magasinCookies = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Décalage d'horloge après une connexion ou un rafraîchissement de jeton : voir reprise.ts.
      global: { fetch: fetchAvecReprise() },
      cookies: {
        getAll() {
          return magasinCookies.getAll();
        },
        setAll(cookiesASdefinir) {
          try {
            for (const { name, value, options } of cookiesASdefinir) {
              magasinCookies.set(name, value, options);
            }
          } catch {
            // Appelé depuis un Server Component : le middleware rafraîchit
            // déjà la session, cet échec d'écriture est sans conséquence.
          }
        },
      },
    },
  );
}
