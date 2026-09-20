// Les deux variables publiques de Supabase, lues avec un message qui dit LAQUELLE manque.
//
// Sans ce contrôle, une variable oubliée sur Vercel donne l'erreur générique de la
// bibliothèque (« URL and API key are required ») sur chaque requête, sans nommer la
// variable. Ici l'erreur nomme la variable et l'écran des réglages où la trouver.
//
// Second contrôle : la clé « anon » est publique — elle part dans le navigateur. Y coller
// par erreur la clé service_role (qui contourne toute la sécurité par ligne) la publierait.
// Ce contrôle refuse de démarrer si le jeton déclare le rôle service_role.
//
// Aucune variable serveur secrète n'est lue ici : le code de l'application n'utilise jamais
// la clé service_role.

function roleDuJeton(cle: string): string | null {
  const morceaux = cle.split(".");
  if (morceaux.length !== 3) return null; // nouveau format (sb_publishable_…) : pas un jeton lisible
  try {
    const base64 = morceaux[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as { role?: unknown };
    return typeof json.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}

export interface EnvSupabase {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

export function verifierEnvSupabase(env: EnvSupabase): { url: string; cleAnonyme: string } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const cleAnonyme = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL est absente ou vide. Renseignez-la (Supabase : Project Settings > API > Project URL) puis redéployez : les variables NEXT_PUBLIC_ sont figées au build.",
    );
  }
  if (!cleAnonyme) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY est absente ou vide. Renseignez-la (Supabase : Project Settings > API > clé anon / publishable) puis redéployez : les variables NEXT_PUBLIC_ sont figées au build.",
    );
  }
  if (roleDuJeton(cleAnonyme) === "service_role") {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY contient une clé service_role : elle serait publiée dans le navigateur. Remplacez-la par la clé anon.",
    );
  }
  return { url, cleAnonyme };
}

// Lecture par des accès LITTÉRAUX : Next.js ne remplace les variables NEXT_PUBLIC_ dans le code
// du navigateur que pour `process.env.NEXT_PUBLIC_…` écrit tel quel. Passer `process.env`
// entier donnerait un objet vide dans le navigateur.
export function lireEnvSupabase(): { url: string; cleAnonyme: string } {
  return verifierEnvSupabase({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
