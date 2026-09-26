-- =====================================================================
-- Tranches d'ancienneté du reste dû : un paramètre d'immeuble.
--
-- Le tableau de bord range le reste dû par ancienneté, comptée en jours depuis
-- l'échéance de chaque appel (appels.date_echeance). Les bornes de ces tranches
-- ne sont pas une règle du code : elles se lisent ici, par immeuble.
--
-- `bornes_anciennete_jours` = bornes HAUTES, en jours de retard, strictement
-- croissantes. Avec {30,60,90} (valeur par défaut) :
--   à échoir (échéance non atteinte), 1-30, 31-60, 61-90, au-delà de 90.
-- Ce n'est pas une disposition du règlement de copropriété : c'est un choix de
-- présentation du cabinet, modifiable sans toucher au code.
--
-- Pas de droit d'écriture pour l'application : aucune interface ne la modifie
-- encore (elle se modifie en SQL). Pour la rendre modifiable depuis
-- l'application, l'ajouter au GRANT de colonnes de 20260919140000.
-- =====================================================================

create or replace function app.bornes_anciennete_valides(p_bornes integer[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(array_length(p_bornes, 1), 0) >= 1
     and array_position(p_bornes, null) is null
     and not exists (
       select 1
       from unnest(p_bornes) with ordinality as b(valeur, rang)
       where b.valeur < 1
          or (b.rang > 1 and b.valeur <= p_bornes[b.rang - 1])
     );
$$;

alter table immeubles
  add column bornes_anciennete_jours integer[] not null default '{30,60,90}',
  add constraint immeubles_bornes_anciennete_valides
    check (app.bornes_anciennete_valides(bornes_anciennete_jours));

comment on column immeubles.bornes_anciennete_jours is
  'Bornes hautes (jours de retard depuis l''échéance) des tranches d''ancienneté du reste dû, strictement croissantes. {30,60,90} : à échoir, 1-30, 31-60, 61-90, au-delà. Paramètre de présentation, pas du règlement.';

-- La contrainte s'évalue avec les droits de celui qui insère ou modifie un immeuble.
grant execute on function app.bornes_anciennete_valides(integer[]) to authenticated;
