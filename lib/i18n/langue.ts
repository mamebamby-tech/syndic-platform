import "server-only";
import { creerClientServeur } from "@/lib/supabase/server";
import { LANGUE_PAR_DEFAUT, normaliserLangue, type Langue } from "@/lib/i18n/config";

// Langue de la personne connectée, lue en base — jamais dans un réglage
// global, jamais déduite d'une adresse électronique (CLAUDE.md règle n°4).
//
// Deux populations, une seule fonction SQL (`public.ma_langue`) :
//   1. le personnel d'un cabinet : `membres.langue` ;
//   2. le copropriétaire : `proprietaires.langue`, via `acces_personnes`.
// Elle existe parce qu'un copropriétaire n'a aucune politique de lecture sur
// `proprietaires` — en donner une exposerait aussi la note interne du syndic.
//
// Personne connectée (page de connexion), rien de rattaché au compte, ou
// lecture impossible : français.
export async function langueDeLaPersonne(): Promise<Langue> {
  // Hors du `try` : `cookies()` signale à Next qu'une route est dynamique en
  // levant une erreur interne, qu'un `catch` ne doit surtout pas avaler.
  const supabase = await creerClientServeur();

  try {
    const { data: claims } = await supabase.auth.getClaims();
    if (!claims?.claims.sub) return LANGUE_PAR_DEFAUT;

    const { data, error } = await supabase.rpc("ma_langue");
    if (error) throw error;
    return normaliserLangue(data);
  } catch (erreur) {
    // Ne jamais empêcher d'afficher une page parce que la préférence de
    // langue est illisible : le français reste toujours servable.
    console.error("Lecture de la langue de la personne impossible :", erreur);
    return LANGUE_PAR_DEFAUT;
  }
}
