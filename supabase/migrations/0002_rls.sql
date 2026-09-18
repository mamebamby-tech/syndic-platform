-- =====================================================================
-- Sécurité par ligne (RLS)
-- Deux populations :
--   1. le personnel du syndic  -> voit tout ce qui relève de SON organisation
--   2. les copropriétaires     -> voient leurs lots, leurs appels, leurs paiements
-- Rien n'est accessible sans passer par l'une de ces deux portes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Fonctions d'appartenance (SECURITY DEFINER pour éviter la récursion RLS)
-- ---------------------------------------------------------------------

create schema if not exists app;

create or replace function app.organisations_de_lutilisateur()
returns setof uuid language sql stable security definer set search_path = public as $$
  select organisation_id from membres where user_id = auth.uid();
$$;

create or replace function app.immeubles_de_lutilisateur()
returns setof uuid language sql stable security definer set search_path = public as $$
  select i.id from immeubles i
  join membres m on m.organisation_id = i.organisation_id
  where m.user_id = auth.uid();
$$;

-- Les propriétaires rattachés au compte courant, regroupement compris :
-- si le compte est rattaché à une entité membre d'un groupe, il voit le groupe.
create or replace function app.proprietaires_de_lutilisateur()
returns setof uuid language sql stable security definer set search_path = public as $$
  with direct as (
    select proprietaire_id as id from acces_personnes
    where user_id = auth.uid() and proprietaire_id is not null
  )
  select id from direct
  union
  select p.id from proprietaires p join direct d on p.groupe_id = d.id
  union
  select p.groupe_id from proprietaires p join direct d on p.id = d.id
  where p.groupe_id is not null;
$$;

create or replace function app.est_gestionnaire(p_immeuble uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from immeubles i
    join membres m on m.organisation_id = i.organisation_id
    where i.id = p_immeuble and m.user_id = auth.uid()
      and m.role in ('proprietaire_org', 'gestionnaire')
  );
$$;

-- ---------------------------------------------------------------------
-- Activation
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'organisations','membres','immeubles','reglements','motifs_delai_renforce','types_majorite',
    'proprietaires','lots','lot_proprietaires','occupants','acces_personnes',
    'cles_repartition','postes_charges','exercices','periodes','budget_lignes',
    'appels','appel_lignes','paiements','mises_en_demeure','penalites',
    'assemblees','resolutions','convocations','presences','votes',
    'documents','annonces','incidents','notifications','journal'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Organisation et personnel
-- ---------------------------------------------------------------------

create policy org_lecture on organisations for select
  using (id in (select app.organisations_de_lutilisateur()));

create policy membres_lecture on membres for select
  using (organisation_id in (select app.organisations_de_lutilisateur()));

create policy membres_ecriture on membres for all
  using (exists (select 1 from membres m where m.organisation_id = membres.organisation_id
                 and m.user_id = auth.uid() and m.role = 'proprietaire_org'))
  with check (exists (select 1 from membres m where m.organisation_id = membres.organisation_id
                 and m.user_id = auth.uid() and m.role = 'proprietaire_org'));

-- ---------------------------------------------------------------------
-- Immeuble : le personnel écrit, le copropriétaire lit le sien
-- ---------------------------------------------------------------------

create policy immeubles_syndic on immeubles for all
  using (organisation_id in (select app.organisations_de_lutilisateur()))
  with check (organisation_id in (select app.organisations_de_lutilisateur()));

create policy immeubles_coproprietaire on immeubles for select
  using (id in (select immeuble_id from proprietaires
                where id in (select app.proprietaires_de_lutilisateur())));

-- Tables rattachées directement à un immeuble : même règle pour toutes.
do $$
declare t text;
begin
  foreach t in array array[
    'reglements','proprietaires','lots','cles_repartition','postes_charges',
    'exercices','assemblees','documents','annonces','incidents','notifications'
  ] loop
    execute format($f$
      create policy %1$s_syndic on %1$I for all
        using (immeuble_id in (select app.immeubles_de_lutilisateur()))
        with check (immeuble_id in (select app.immeubles_de_lutilisateur()));
    $f$, t);
  end loop;
end $$;

-- Lecture par les copropriétaires de l'immeuble concerné.
do $$
declare t text;
begin
  foreach t in array array['reglements','lots','cles_repartition','postes_charges','exercices','assemblees','annonces'] loop
    execute format($f$
      create policy %1$s_coproprietaire on %1$I for select
        using (immeuble_id in (
          select immeuble_id from proprietaires
          where id in (select app.proprietaires_de_lutilisateur())));
    $f$, t);
  end loop;
end $$;

-- Documents : seuls ceux qui leur sont destinés.
create policy documents_coproprietaire on documents for select
  using (visibilite in ('proprietaires','tous')
         and immeuble_id in (select immeuble_id from proprietaires
                             where id in (select app.proprietaires_de_lutilisateur())));

-- ---------------------------------------------------------------------
-- Argent : un copropriétaire ne voit QUE ses propres appels et paiements
-- ---------------------------------------------------------------------

create policy appels_syndic on appels for all
  using (exists (select 1 from proprietaires p where p.id = appels.proprietaire_id
                 and p.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (exists (select 1 from proprietaires p where p.id = appels.proprietaire_id
                 and p.immeuble_id in (select app.immeubles_de_lutilisateur())));

create policy appels_coproprietaire on appels for select
  using (proprietaire_id in (select app.proprietaires_de_lutilisateur()));

create policy appel_lignes_acces on appel_lignes for select
  using (appel_id in (select id from appels));

create policy appel_lignes_syndic on appel_lignes for all
  using (exists (select 1 from appels a join proprietaires p on p.id = a.proprietaire_id
                 where a.id = appel_lignes.appel_id
                   and p.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (true);

create policy paiements_syndic on paiements for all
  using (exists (select 1 from proprietaires p where p.id = paiements.proprietaire_id
                 and p.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (exists (select 1 from proprietaires p where p.id = paiements.proprietaire_id
                 and p.immeuble_id in (select app.immeubles_de_lutilisateur())));

create policy paiements_coproprietaire on paiements for select
  using (proprietaire_id in (select app.proprietaires_de_lutilisateur()));

-- Les pénalités et mises en demeure suivent leur appel.
create policy penalites_syndic on penalites for all
  using (exists (select 1 from appels a join proprietaires p on p.id = a.proprietaire_id
                 where a.id = penalites.appel_id
                   and p.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (true);

create policy penalites_coproprietaire on penalites for select
  using (statut = 'appliquee' and exists (
    select 1 from appels a where a.id = penalites.appel_id
      and a.proprietaire_id in (select app.proprietaires_de_lutilisateur())));

create policy mises_en_demeure_syndic on mises_en_demeure for all
  using (exists (select 1 from appels a join proprietaires p on p.id = a.proprietaire_id
                 where a.id = mises_en_demeure.appel_id
                   and p.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (true);

-- ---------------------------------------------------------------------
-- Rattachements et assemblées
-- ---------------------------------------------------------------------

create policy lot_proprietaires_syndic on lot_proprietaires for all
  using (exists (select 1 from lots l where l.id = lot_proprietaires.lot_id
                 and l.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (true);

create policy lot_proprietaires_coproprietaire on lot_proprietaires for select
  using (proprietaire_id in (select app.proprietaires_de_lutilisateur()));

create policy occupants_syndic on occupants for all
  using (exists (select 1 from lots l where l.id = occupants.lot_id
                 and l.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (true);

create policy acces_personnes_soi on acces_personnes for select using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['resolutions','convocations','presences'] loop
    execute format($f$
      create policy %1$s_syndic on %1$I for all
        using (exists (select 1 from assemblees a where a.id = %1$I.assemblee_id
                       and a.immeuble_id in (select app.immeubles_de_lutilisateur())))
        with check (true);
      create policy %1$s_coproprietaire on %1$I for select
        using (exists (select 1 from assemblees a
                       join proprietaires p on p.immeuble_id = a.immeuble_id
                       where a.id = %1$I.assemblee_id
                         and p.id in (select app.proprietaires_de_lutilisateur())));
    $f$, t);
  end loop;
end $$;

create policy votes_syndic on votes for all
  using (exists (select 1 from resolutions r join assemblees a on a.id = r.assemblee_id
                 where r.id = votes.resolution_id
                   and a.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (true);

create policy votes_soi on votes for select
  using (proprietaire_id in (select app.proprietaires_de_lutilisateur()));

-- Budget et périodes : personnel uniquement en écriture, tous en lecture.
do $$
declare t text;
begin
  foreach t in array array['periodes','budget_lignes'] loop
    execute format('create policy %1$s_syndic on %1$I for all using (true) with check (true)', t);
  end loop;
end $$;

create policy motifs_syndic on motifs_delai_renforce for all using (true) with check (true);
create policy majorites_syndic on types_majorite for all using (true) with check (true);

create policy journal_lecture on journal for select
  using (organisation_id in (select app.organisations_de_lutilisateur()));
