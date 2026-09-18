-- =====================================================================
-- Corrige la sécurité par ligne de periodes et budget_lignes.
--
-- La politique d'origine ('using (true) with check (true)') ne filtrait
-- sur aucun périmètre : n'importe quel utilisateur authentifié, de
-- n'importe quel cabinet, pouvait lire et modifier le budget de n'importe
-- quel immeuble. Une fuite de données entre cabinets au sens de la règle
-- CLAUDE.md n°2. Ces deux tables n'avaient jamais été branchées à une
-- requête réelle jusqu'à l'écran Budget de cette session.
-- =====================================================================

drop policy if exists periodes_syndic on periodes;
drop policy if exists budget_lignes_syndic on budget_lignes;

create policy periodes_syndic on periodes for all
  using (exercice_id in (
    select ex.id from exercices ex
    where ex.immeuble_id in (select app.immeubles_de_lutilisateur())
  ))
  with check (exercice_id in (
    select ex.id from exercices ex
    where ex.immeuble_id in (select app.immeubles_de_lutilisateur())
  ));

create policy periodes_coproprietaire on periodes for select
  using (exercice_id in (
    select ex.id from exercices ex
    where ex.immeuble_id in (
      select immeuble_id from proprietaires
      where id in (select app.proprietaires_de_lutilisateur())
    )
  ));

create policy budget_lignes_syndic on budget_lignes for all
  using (periode_id in (
    select p.id from periodes p
    join exercices ex on ex.id = p.exercice_id
    where ex.immeuble_id in (select app.immeubles_de_lutilisateur())
  ))
  with check (periode_id in (
    select p.id from periodes p
    join exercices ex on ex.id = p.exercice_id
    where ex.immeuble_id in (select app.immeubles_de_lutilisateur())
  ));
