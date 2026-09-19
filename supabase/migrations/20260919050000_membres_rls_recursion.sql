-- =====================================================================
-- Corrige une récursion infinie sur la politique RLS de `membres`.
--
-- Trouvée par le balayage générique de tests/rls-audit.test.ts : toute
-- requête directe sur `membres` (select count(*) from membres, par
-- exemple) échouait avec "infinite recursion detected in policy for
-- relation membres" pour un utilisateur authentifié.
--
-- Cause : `membres_ecriture` teste l'appartenance avec une sous-requête
-- qui interroge `membres` elle-même, sans passer par une fonction
-- SECURITY DEFINER — contrairement à toutes les autres politiques du
-- projet. Évaluer cette sous-requête réévalue la RLS de `membres`, qui
-- réévalue `membres_ecriture`, qui réinterroge `membres` : boucle infinie.
--
-- Ce bug existe depuis 20260918090100_rls.sql, indépendamment de tout ce
-- qui a été touché cette session ou la précédente. Aucun écran ne
-- l'avait encore atteint : personne n'avait interrogé `membres`
-- directement avant ce test.
-- =====================================================================

create or replace function app.est_proprietaire_org(p_organisation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membres m
    where m.organisation_id = p_organisation
      and m.user_id = auth.uid()
      and m.role = 'proprietaire_org'
  );
$$;

drop policy if exists membres_ecriture on membres;
create policy membres_ecriture on membres for all
  using (app.est_proprietaire_org(membres.organisation_id))
  with check (app.est_proprietaire_org(membres.organisation_id));
