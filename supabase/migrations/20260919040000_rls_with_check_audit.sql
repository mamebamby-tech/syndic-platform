-- =====================================================================
-- Audit complet de la sécurité par ligne, dans le prolongement de
-- 20260919010000_periodes_budget_rls.sql.
--
-- Deux défauts du même type dans 20260918090100_rls.sql :
--
-- 1. motifs_delai_renforce et types_majorite avaient une politique
--    `using (true) with check (true)` : aucun filtre sur le périmètre,
--    en lecture comme en écriture. Rattachées ici à leur règlement, donc
--    à leur immeuble, donc à l'organisation.
--
-- 2. Sept politiques `for all` avaient un `using` correctement scopé mais
--    un `with check (true)` : appel_lignes, penalites, mises_en_demeure,
--    lot_proprietaires, occupants, resolutions/convocations/presences,
--    votes. Le `using` ne protège que la lecture et les lignes déjà
--    existantes qu'on cible ; il ne protège pas un `insert`, que seul le
--    `with check` gouverne. Avec `with check (true)`, un gestionnaire de
--    N'IMPORTE QUEL cabinet pouvait insérer une ligne dans ces tables en
--    la rattachant à un appel, un lot ou une assemblée d'un AUTRE cabinet
--    — la politique ne l'aurait jamais revérifié après coup.
--
-- (paiements_syndic avait déjà un with check correctement scopé : pas
-- touché ici.)
--
-- Chaque politique ci-dessous reprend exactement la condition de son
-- `using` pour son `with check`, sans rien changer au périmètre qu'elle
-- couvrait déjà en lecture.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. motifs_delai_renforce et types_majorite : rattachés à reglement_id
-- ---------------------------------------------------------------------

drop policy if exists motifs_syndic on motifs_delai_renforce;
create policy motifs_syndic on motifs_delai_renforce for all
  using (reglement_id in (
    select r.id from reglements r
    where r.immeuble_id in (select app.immeubles_de_lutilisateur())
  ))
  with check (reglement_id in (
    select r.id from reglements r
    where r.immeuble_id in (select app.immeubles_de_lutilisateur())
  ));

drop policy if exists majorites_syndic on types_majorite;
create policy majorites_syndic on types_majorite for all
  using (reglement_id in (
    select r.id from reglements r
    where r.immeuble_id in (select app.immeubles_de_lutilisateur())
  ))
  with check (reglement_id in (
    select r.id from reglements r
    where r.immeuble_id in (select app.immeubles_de_lutilisateur())
  ));

-- ---------------------------------------------------------------------
-- 2. with check aussi strict que using, sur les sept politiques concernées
-- ---------------------------------------------------------------------

drop policy if exists appel_lignes_syndic on appel_lignes;
create policy appel_lignes_syndic on appel_lignes for all
  using (exists (select 1 from appels a join proprietaires p on p.id = a.proprietaire_id
                 where a.id = appel_lignes.appel_id
                   and p.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (exists (select 1 from appels a join proprietaires p on p.id = a.proprietaire_id
                 where a.id = appel_lignes.appel_id
                   and p.immeuble_id in (select app.immeubles_de_lutilisateur())));

drop policy if exists penalites_syndic on penalites;
create policy penalites_syndic on penalites for all
  using (exists (select 1 from appels a join proprietaires p on p.id = a.proprietaire_id
                 where a.id = penalites.appel_id
                   and p.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (exists (select 1 from appels a join proprietaires p on p.id = a.proprietaire_id
                 where a.id = penalites.appel_id
                   and p.immeuble_id in (select app.immeubles_de_lutilisateur())));

drop policy if exists mises_en_demeure_syndic on mises_en_demeure;
create policy mises_en_demeure_syndic on mises_en_demeure for all
  using (exists (select 1 from appels a join proprietaires p on p.id = a.proprietaire_id
                 where a.id = mises_en_demeure.appel_id
                   and p.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (exists (select 1 from appels a join proprietaires p on p.id = a.proprietaire_id
                 where a.id = mises_en_demeure.appel_id
                   and p.immeuble_id in (select app.immeubles_de_lutilisateur())));

drop policy if exists lot_proprietaires_syndic on lot_proprietaires;
create policy lot_proprietaires_syndic on lot_proprietaires for all
  using (exists (select 1 from lots l where l.id = lot_proprietaires.lot_id
                 and l.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (exists (select 1 from lots l where l.id = lot_proprietaires.lot_id
                 and l.immeuble_id in (select app.immeubles_de_lutilisateur())));

drop policy if exists occupants_syndic on occupants;
create policy occupants_syndic on occupants for all
  using (exists (select 1 from lots l where l.id = occupants.lot_id
                 and l.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (exists (select 1 from lots l where l.id = occupants.lot_id
                 and l.immeuble_id in (select app.immeubles_de_lutilisateur())));

do $$
declare t text;
begin
  foreach t in array array['resolutions','convocations','presences'] loop
    execute format('drop policy if exists %1$s_syndic on %1$I', t);
    execute format($f$
      create policy %1$s_syndic on %1$I for all
        using (exists (select 1 from assemblees a where a.id = %1$I.assemblee_id
                       and a.immeuble_id in (select app.immeubles_de_lutilisateur())))
        with check (exists (select 1 from assemblees a where a.id = %1$I.assemblee_id
                       and a.immeuble_id in (select app.immeubles_de_lutilisateur())));
    $f$, t);
  end loop;
end $$;

drop policy if exists votes_syndic on votes;
create policy votes_syndic on votes for all
  using (exists (select 1 from resolutions r join assemblees a on a.id = r.assemblee_id
                 where r.id = votes.resolution_id
                   and a.immeuble_id in (select app.immeubles_de_lutilisateur())))
  with check (exists (select 1 from resolutions r join assemblees a on a.id = r.assemblee_id
                 where r.id = votes.resolution_id
                   and a.immeuble_id in (select app.immeubles_de_lutilisateur())));
