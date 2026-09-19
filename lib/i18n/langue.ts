import "server-only";
import { creerClientServeur } from "@/lib/supabase/server";
import { LANGUE_PAR_DEFAUT, normaliserLangue, type Langue } from "@/lib/i18n/config";

// Langue de la personne connectée, lue en base — jamais dans un réglage
// global, jamais déduite d'une adresse électronique (CLAUDE.md règle n°4).
//
// Deux populations :
//   1. le personnel d'un cabinet : `membres.langue` ;
//   2. le copropriétaire : `proprietaires.langue`, via `acces_personnes`
//      (la ligne `proprietaires` rattachée au compte, pas son groupe).
// Personne connectée (page de connexion), ou lecture impossible : français.
export async function langueDeLaPersonne(): Promise<Langue> {
  // Hors du `try` : `cookies()` signale à Next qu'une route est dynamique en
  // levant une erreur interne, qu'un `catch` ne doit surtout pas avaler.
  const supabase = await creerClientServeur();

  try {
    const { data: claims } = await supabase.auth.getClaims();
    const utilisateurId = claims?.claims.sub;
    if (!utilisateurId) return LANGUE_PAR_DEFAUT;

    // Filtre explicite sur l'utilisateur : la politique `membres_lecture`
    // laisse voir tous les membres du cabinet, pas seulement soi.
    const { data: membre, error: erreurMembre } = await supabase
      .from("membres")
      .select("langue")
      .eq("user_id", utilisateurId)
      .order("cree_le")
      .limit(1)
      .maybeSingle();
    if (erreurMembre) throw erreurMembre;
    if (membre) return normaliserLangue(membre.langue);

    const { data: acces, error: erreurAcces } = await supabase
      .from("acces_personnes")
      .select("proprietaire_id")
      .eq("user_id", utilisateurId)
      .not("proprietaire_id", "is", null)
      .order("cree_le")
      .limit(1)
      .maybeSingle();
    if (erreurAcces) throw erreurAcces;
    if (!acces?.proprietaire_id) return LANGUE_PAR_DEFAUT;

    const { data: proprietaire, error: erreurProprietaire } = await supabase
      .from("proprietaires")
      .select("langue")
      .eq("id", acces.proprietaire_id)
      .maybeSingle();
    if (erreurProprietaire) throw erreurProprietaire;
    return normaliserLangue(proprietaire?.langue);
  } catch (erreur) {
    // Ne jamais empêcher d'afficher une page parce que la préférence de
    // langue est illisible : le français reste toujours servable.
    console.error("Lecture de la langue de la personne impossible :", erreur);
    return LANGUE_PAR_DEFAUT;
  }
}
