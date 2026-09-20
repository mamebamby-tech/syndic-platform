// Nouvelle tentative bornée sur « JWT issued at future ».
//
// Supabase émet le jeton de session avec l'horloge de son service d'authentification ;
// PostgREST le refuse (401, code PGRST303, « JWT issued at future ») si SA propre horloge
// retarde sur celle qui a émis le jeton, même d'une seconde. Le cas se présente juste
// après une connexion ou un rafraîchissement de jeton — le moment exact où l'application
// enchaîne une requête avec le jeton tout neuf, sur la connexion normale par code comme
// sur le lien de développement. L'erreur est transitoire : elle disparaît dès que l'horloge
// rattrape l'`iat`.
//
// Une requête refusée pour cette raison l'est à l'authentification, AVANT toute exécution
// (aucune ligne lue ni écrite, aucune fonction appelée) : la rejouer ne peut donc pas
// dupliquer un effet, y compris pour un insert ou un appel de fonction.
//
// La reprise est bornée (nombre et durée) : si le décalage persiste, la dernière réponse
// est rendue telle quelle et l'erreur remonte à l'appelant, au lieu de retenir la page.

// Attente avant chaque nouvelle tentative : au plus 4 tentatives de plus, 3,75 s au total.
export const DELAIS_REPRISE_MS: readonly number[] = [250, 500, 1000, 2000];

type Fetch = typeof fetch;

async function estDecalageHorloge(reponse: Response): Promise<boolean> {
  if (reponse.status !== 401) return false;
  const enTete = reponse.headers.get("www-authenticate") ?? "";
  if (/issued at future/i.test(enTete)) return true;
  try {
    const corps = (await reponse.clone().json()) as { code?: unknown; message?: unknown };
    return corps.code === "PGRST303" && /issued at future/i.test(String(corps.message ?? ""));
  } catch {
    return false;
  }
}

// Un corps qu'on ne peut pas relire (flux) ne se rejoue pas : dans ce cas on ne reprend pas.
function rejouable(entree: RequestInfo | URL, init?: RequestInit): boolean {
  if (typeof entree !== "string" && !(entree instanceof URL)) return false;
  const corps = init?.body;
  return corps == null || typeof corps === "string" || corps instanceof URLSearchParams || corps instanceof FormData || corps instanceof Blob || corps instanceof ArrayBuffer;
}

function attendre(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const minuteur = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(minuteur);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export function fetchAvecReprise(base: Fetch = fetch, delais: readonly number[] = DELAIS_REPRISE_MS): Fetch {
  return async (entree, init) => {
    let reponse = await base(entree, init);
    if (!rejouable(entree, init)) return reponse;
    for (const delai of delais) {
      if (!(await estDecalageHorloge(reponse))) return reponse;
      console.warn(`[horloge] JWT issued at future : nouvelle tentative dans ${delai} ms`);
      await attendre(delai, init?.signal);
      reponse = await base(entree, init);
    }
    return reponse;
  };
}
