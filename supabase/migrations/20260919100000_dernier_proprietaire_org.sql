-- =====================================================================
-- Une organisation garde toujours au moins un `proprietaire_org`.
--
-- Sans lui, plus personne ne peut administrer les membres du cabinet :
-- `membres_ecriture` réserve l'écriture au rôle `proprietaire_org`
-- (20260919050000_membres_rls_recursion.sql). Le dernier qui se rétrograde,
-- se supprime, ou dont le compte est supprimé, verrouille le cabinet pour
-- de bon — seule une intervention en SQL le réparerait.
--
-- Le déclencheur refuse toute opération qui retire le rôle à la dernière
-- ligne `proprietaire_org` d'une organisation :
--   - DELETE de cette ligne ;
--   - UPDATE de `role` vers autre chose ;
--   - UPDATE de `organisation_id` (la ligne quitte le cabinet).
-- Y compris quand elle est déclenchée en cascade par la suppression d'un
-- compte (`auth.users`) : supprimer le dernier propriétaire est refusé.
--
-- Deux exceptions, voulues :
--   - la suppression de l'organisation elle-même (cascade) : il n'y a plus
--     rien à protéger ;
--   - une organisation qui n'a JAMAIS eu de propriétaire (en cours de
--     création) : l'invariant protège une perte, il n'interdit pas un début.
--
-- AFTER ROW : le contrôle voit l'état final de la requête, donc un
-- `delete from membres where organisation_id = X` qui viderait tous les
-- propriétaires est refusé même s'il les traite un par un. Le verrou sur la
-- ligne de l'organisation sérialise deux transactions concurrentes : sans
-- lui, deux propriétaires qui se rétrogradent au même instant verraient
-- chacun l'autre encore en place, et l'organisation en resterait sans.
-- =====================================================================

create or replace function app.garder_un_proprietaire_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role <> 'proprietaire_org' then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.role = 'proprietaire_org'
     and new.organisation_id = old.organisation_id then
    return null;
  end if;

  -- Verrou, et détection de la suppression en cascade de l'organisation :
  -- si elle n'existe plus, rien à protéger.
  perform 1 from organisations where id = old.organisation_id for update;
  if not found then
    return null;
  end if;

  if not exists (
    select 1 from membres
    where organisation_id = old.organisation_id and role = 'proprietaire_org'
  ) then
    raise exception
      'Une organisation garde au moins un proprietaire_org : opération refusée'
      using errcode = '23001', hint = 'Nommez un autre proprietaire_org avant de retirer celui-ci.';
  end if;
  return null;
end $$;

create trigger membres_garder_un_proprietaire_org
  after delete or update of role, organisation_id on membres
  for each row execute function app.garder_un_proprietaire_org();
