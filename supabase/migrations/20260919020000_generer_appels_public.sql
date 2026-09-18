-- =====================================================================
-- Expose app.generer_appels() à l'application, avec le contrôle de
-- périmètre qui lui manquait.
--
-- app.generer_appels() est SECURITY DEFINER : il doit pouvoir écrire des
-- appels pour tous les lots de la période, donc il contourne la RLS par
-- construction. L'appeler depuis le client sans garde-fou permettrait à
-- n'importe quel utilisateur authentifié de générer les appels d'un
-- immeuble qui n'est pas le sien.
--
-- PostgREST n'expose que le schéma "public" : app.* n'est donc de toute
-- façon pas atteignable depuis supabase-js sans cette enveloppe.
--
-- Le garde-fou vit ici plutôt que dans app.generer_appels lui-même : les
-- tests et les tâches serveur l'appellent en direct via une connexion
-- Postgres hors contexte auth.uid() (même niveau de confiance qu'un
-- chargement de seed) et doivent continuer à le pouvoir.
-- =====================================================================

create or replace function public.generer_appels(p_periode_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  v_immeuble uuid;
begin
  select ex.immeuble_id into v_immeuble
  from periodes p
  join exercices ex on ex.id = p.exercice_id
  where p.id = p_periode_id;

  if v_immeuble is null then
    raise exception 'Période introuvable : %', p_periode_id;
  end if;

  if not app.est_gestionnaire(v_immeuble) then
    raise exception 'Non autorisé : ce compte ne gère pas cet immeuble';
  end if;

  return app.generer_appels(p_periode_id);
end $$;

revoke all on function public.generer_appels(uuid) from public;
grant execute on function public.generer_appels(uuid) to authenticated;

comment on function public.generer_appels is
  'Enveloppe publique de app.generer_appels : vérifie que l''appelant '
  'gère l''immeuble de la période avant de déléguer à la fonction interne.';
