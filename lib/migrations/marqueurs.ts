// Traces durables des migrations, pour reconstituer l'état d'une base qui n'a PAS
// d'historique (syndic-dev et la base réelle en étaient là quand le suivi a été mis en
// place). Une expression SQL par migration, vraie quand la migration a été appliquée.
//
// Uniquement des traces DURABLES : une colonne, une table, une fonction créée par la
// migration et jamais supprimée depuis. Pas « la politique X existe » : la plupart des
// politiques sont remplacées par une migration ultérieure, et la trace serait fausse
// dès la suivante. Les migrations qui ne font que remplacer des objets existants
// (SANS_MARQUEUR) n'ont pas de trace propre : on les DÉDUIT — la trace présente la plus
// récente implique que toutes les migrations antérieures ont été appliquées, puisqu'elles
// s'appliquent dans l'ordre.
//
// Chaque expression ne lit que le catalogue (to_regclass, to_regprocedure,
// information_schema) : elle ne lit AUCUNE donnée, et s'exécute en lecture seule.
//
// Ce fichier ne sert qu'à l'ADOPTION d'une base sans historique. Une fois l'historique
// en place, une migration nouvelle n'a pas besoin de marqueur : elle est enregistrée à son
// application.

// Dernière migration existante quand le suivi a été mis en place : au-delà, plus de marqueur.
export const VERSION_DE_REFERENCE = "20260920010000";

export const MARQUEURS: Record<string, string> = {
  // schema : la table de base
  "20260918090000": `to_regclass('public.organisations') is not null and to_regclass('public.appels') is not null`,
  // rls : les fonctions d'appartenance
  "20260918090100": `to_regprocedure('app.immeubles_de_lutilisateur()') is not null`,
  // repartition : le moteur
  "20260918090200": `to_regprocedure('app.voix_assemblee(uuid)') is not null and to_regprocedure('app.destinataire_du_lot(uuid, date)') is not null`,
  // repartition_precision : la nouvelle quote_part (plus grand reste, en centimes entiers)
  "20260919000000": `coalesce(pg_get_functiondef(to_regprocedure('app.quote_part(uuid, numeric)')) ilike '%centimes entiers%', false)`,
  // periodes_budget_rls : la politique de lecture des copropriétaires sur les périodes
  "20260919010000": `exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'periodes' and policyname = 'periodes_coproprietaire')`,
  // generer_appels_public : l'enveloppe publique
  "20260919020000": `to_regprocedure('public.generer_appels(uuid)') is not null`,
  // app_schema_usage
  "20260919030000": `has_schema_privilege('authenticated', 'app', 'USAGE')`,
  // membres_rls_recursion : la fonction qui remplace la sous-requête récursive
  "20260919050000": `to_regprocedure('app.est_proprietaire_org(uuid)') is not null`,
  // langue_preferee
  "20260919060000": `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'membres' and column_name = 'langue')`,
  // changer_langue
  "20260919070000": `to_regprocedure('public.changer_langue(text)') is not null and to_regclass('app.langues_supportees') is not null`,
  // reference_appel
  "20260919080000": `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'immeubles' and column_name = 'code_reference')`,
  // modalites_reglement
  "20260919090000": `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'immeubles' and column_name = 'compte_numero')`,
  // dernier_proprietaire_org
  "20260919100000": `to_regprocedure('app.garder_un_proprietaire_org()') is not null`,
  // parametres_immeuble
  "20260919110000": `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'immeubles' and column_name = 'numeros_marchands')`,
  // instantane_appel
  "20260919120000": `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'appels' and column_name = 'instantane')`,
  // budget_appels_coherence
  "20260919130000": `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'appels' and column_name = 'obsolete')`,
  // double_validation_coordonnees
  "20260919140000": `to_regclass('public.coordonnees_paiement_versions') is not null`,
  // lecteur_lecture_seule
  "20260920000000": `to_regprocedure('app.immeubles_habilites()') is not null`,
  // notes_proprietaires
  "20260920010000": `to_regclass('public.proprietaires_notes') is not null`,
};

// Migrations qui ne font que REMPLACER des objets existants : pas de trace durable propre.
export const SANS_MARQUEUR: Record<string, string> = {
  "20260919040000": "remplace des politiques (with check) que la migration lecteur_lecture_seule remplace à son tour",
};
