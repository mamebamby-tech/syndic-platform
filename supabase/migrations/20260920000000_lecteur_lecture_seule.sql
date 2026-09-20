-- =====================================================================
-- Le lecteur est en lecture seule, partout.
--
-- Constat (docs/06-decisions.md) : les politiques `*_syndic` étaient `for all`
-- sur « tout membre du cabinet » (app.immeubles_de_lutilisateur, qui ne regarde
-- pas le rôle). Un lecteur pouvait donc modifier le règlement de copropriété
-- (taux de pénalité, quorums, délais), les lots, les propriétaires, les postes
-- de charges, les exercices, les appels, les paiements, les assemblées et leurs
-- votes... Seuls `immeubles`, `appels` (colonnes) et `membres` étaient fermés.
--
-- Règle : LECTURE pour tout le personnel du cabinet ; INSERTION, MODIFICATION
-- et SUPPRESSION réservées au gestionnaire et au proprietaire_org, décidés par
-- app.est_gestionnaire() — l'unique définition de « habilité », déjà utilisée
-- par l'émission des appels, la génération et les paramètres de l'immeuble.
--
-- Comment : chaque politique `for all` fondée sur app.immeubles_de_lutilisateur()
-- est remplacée par quatre politiques (lecture, insertion, modification,
-- suppression). La lecture garde EXACTEMENT l'expression d'origine ; les trois
-- écritures y remplacent app.immeubles_de_lutilisateur() par
-- app.immeubles_habilites(), qui ne retient que les immeubles où
-- app.est_gestionnaire() est vrai. La transformation est faite sur les
-- politiques réellement présentes (pg_policies), pas recopiée à la main : aucune
-- table ne peut être oubliée, et une vérification finale échoue si une écriture
-- reste ouverte à tout membre.
--
-- Non concernées, déjà correctes : `membres` (écriture réservée au
-- proprietaire_org), `immeubles` (20260919110000), `appels` (colonnes, 130000),
-- `organisations`, `journal`, `coordonnees_paiement_versions`, `acces_personnes`
-- (lecture seule pour tous), les politiques `*_coproprietaire` (lecture seule).
-- =====================================================================

-- Les immeubles où l'utilisateur courant est habilité. Défini PAR
-- app.est_gestionnaire : si la définition d'« habilité » change un jour, elle
-- change ici sans autre modification.
create or replace function app.immeubles_habilites()
returns setof uuid language sql stable security definer set search_path = public as $$
  select i.id from immeubles i where app.est_gestionnaire(i.id);
$$;

do $$
declare
  r          record;
  v_lecture  text;
  v_ecrit_u  text;
  v_ecrit_c  text;
  n          integer := 0;
begin
  for r in
    select policyname, tablename, qual, coalesce(with_check, qual) as controle
    from pg_policies
    where schemaname = 'public'
      and cmd = 'ALL'
      and qual like '%immeubles_de_lutilisateur%'
    order by tablename
  loop
    v_lecture := r.qual;
    v_ecrit_u := replace(r.qual, 'immeubles_de_lutilisateur', 'immeubles_habilites');
    v_ecrit_c := replace(r.controle, 'immeubles_de_lutilisateur', 'immeubles_habilites');

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    execute format('create policy %I on public.%I for select using (%s)',
                   r.tablename || '_lecture_personnel', r.tablename, v_lecture);
    execute format('create policy %I on public.%I for insert with check (%s)',
                   r.tablename || '_insertion_habilites', r.tablename, v_ecrit_c);
    execute format('create policy %I on public.%I for update using (%s) with check (%s)',
                   r.tablename || '_modification_habilites', r.tablename, v_ecrit_u, v_ecrit_c);
    execute format('create policy %I on public.%I for delete using (%s)',
                   r.tablename || '_suppression_habilites', r.tablename, v_ecrit_u);
    n := n + 1;
  end loop;

  -- Garde-fou de la migration : plus AUCUNE écriture ouverte à tout membre.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%immeubles_de_lutilisateur%'
  ) then
    raise exception 'Une politique d''écriture reste ouverte à tout membre du cabinet (immeubles_de_lutilisateur)';
  end if;

  raise notice '% politiques for all remplacées par lecture / insertion / modification / suppression', n;
end $$;
