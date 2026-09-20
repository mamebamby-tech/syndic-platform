-- =====================================================================
-- Enregistrement manuel des paiements.
--
-- Un paiement (virement, virement international, espèces, Wave ou Orange Money
-- saisi à la main) est rattaché à un APPEL ÉMIS et à sa référence. Le statut de
-- l'appel SUIT les paiements : émis → partiel → soldé, dans les deux sens.
--
--   * Un paiement enregistré ne se modifie JAMAIS et ne se supprime jamais. Une
--     erreur se corrige par une écriture inverse (montant négatif, motif
--     obligatoire), qui est un paiement à son tour : tracée comme lui.
--   * Chaque paiement et chaque annulation laisse une ligne dans `journal`,
--     posée par déclencheur (donc aussi par SQL direct).
--   * Les règles vivent en base (déclencheurs, droits de colonne), pas dans
--     l'écran : aucune route, oubliée ou future, ne les contourne.
--   * Les utilisateurs n'écrivent pas dans `paiements` : ils passent par
--     public.enregistrer_paiement() et public.annuler_paiement(), qui vérifient
--     qu'ils sont gestionnaire ou proprietaire_org de l'immeuble de l'appel.
--
-- Pas de trop-perçu : un paiement qui dépasse le reste dû est refusé. Un
-- trop-perçu est une décision (avoir, remboursement) qui n'est pas construite ;
-- l'accepter en silence fausserait le solde.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colonnes et contraintes
-- ---------------------------------------------------------------------

alter table paiements
  -- Le paiement que cette ligne annule (écriture inverse) ; nul pour un paiement.
  add column annule_paiement_id uuid references paiements(id),
  -- Pourquoi : obligatoire pour une annulation.
  add column motif text,
  -- Qui a saisi : courriel ou numéro au moment de l'action (l'auteur peut être
  -- supprimé ensuite : la trace garde qui c'était, comme journal).
  add column saisi_par_libelle text;

alter table paiements
  drop constraint paiements_saisi_par_fkey,
  add constraint paiements_saisi_par_fkey
    foreign key (saisi_par) references auth.users(id) on delete set null;

-- Un paiement suit son appel : supprimer l'appel (seulement possible par la
-- suppression en cascade de sa période, donc d'un cabinet de test) supprime ses
-- paiements. Avant, `set null` laissait des paiements orphelins.
alter table paiements
  drop constraint paiements_appel_id_fkey,
  add constraint paiements_appel_id_fkey
    foreign key (appel_id) references appels(id) on delete cascade;

-- `not valid` : contraintes appliquées à toute nouvelle ligne, sans réexaminer
-- les lignes déjà présentes (une base réelle peut en contenir).
alter table paiements
  add constraint paiements_appel_requis check (appel_id is not null) not valid,
  add constraint paiements_sens_montant check (
    (annule_paiement_id is null and montant > 0)
    or (annule_paiement_id is not null and montant < 0)
  ) not valid,
  add constraint paiements_motif_annulation check (
    annule_paiement_id is null or btrim(coalesce(motif, '')) <> ''
  ) not valid;

-- Un paiement ne s'annule qu'une fois.
create unique index paiements_une_annulation on paiements (annule_paiement_id)
  where annule_paiement_id is not null;

comment on column paiements.annule_paiement_id is
  'Renseigné pour une écriture inverse : le paiement qu''elle annule. Un paiement enregistré ne se modifie ni ne se supprime.';

-- ---------------------------------------------------------------------
-- 2. Un paiement enregistré ne change plus
-- ---------------------------------------------------------------------

create or replace function app.paiement_immuable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    -- Exception : la suppression en cascade de l'appel ou du propriétaire (donc
    -- d'un cabinet de test). Tant que les deux existent, c'est une suppression
    -- directe : refusée.
    if exists (select 1 from appels where id = old.appel_id)
       and exists (select 1 from proprietaires where id = old.proprietaire_id) then
      raise exception 'Un paiement ne se supprime pas : annulez-le par une écriture inverse'
        using errcode = '23514';
    end if;
    return old;
  end if;

  -- Seule modification tolérée : le compte de l'auteur est supprimé
  -- (`on delete set null`) ; `saisi_par_libelle` garde qui c'était.
  if new.saisi_par is null
     and (to_jsonb(new) - 'saisi_par') is not distinct from (to_jsonb(old) - 'saisi_par') then
    return new;
  end if;
  raise exception 'Un paiement enregistré ne se modifie pas : annulez-le par une écriture inverse'
    using errcode = '23514';
end $$;

create trigger paiements_immuable
  before update or delete on paiements
  for each row execute function app.paiement_immuable();

-- ---------------------------------------------------------------------
-- 3. Ce qu'un paiement doit respecter, pour tout rôle et toute voie
--
-- Codes d'erreur propres (classe PA), lus par l'application :
--   PA001  l'appel n'est pas payable (brouillon ou annulé)
--   PA002  le paiement dépasse le reste dû
--   PA003  moyen de règlement non pris en charge à la saisie
--   PA004  montant invalide
--   PA005  ce paiement est déjà annulé
--   PA006  motif d'annulation requis
--   PA007  date de paiement dans le futur
--   PA008  ce paiement ne peut pas être annulé
--   PA009  le destinataire ne correspond pas à l'appel
-- ---------------------------------------------------------------------

create or replace function app.valider_paiement()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_appel    appels;
  v_origine  paiements;
  v_net      numeric;
begin
  -- Verrou de l'appel : deux paiements simultanés ne peuvent pas, ensemble,
  -- dépasser le reste dû.
  select * into v_appel from appels where id = new.appel_id for update;
  if not found then
    raise exception 'Appel introuvable' using errcode = '23503';
  end if;

  if new.proprietaire_id is distinct from v_appel.proprietaire_id then
    raise exception 'Le paiement doit être au nom du destinataire de l''appel' using errcode = 'PA009';
  end if;

  -- Toujours confirmé : c'est le syndic qui constate avoir reçu l'argent.
  new.statut := 'confirme';
  new.saisi_par := auth.uid();
  new.saisi_par_libelle := app.libelle_acteur();

  if new.annule_paiement_id is null then
    if v_appel.statut not in ('emis', 'partiel', 'solde') then
      raise exception 'Un paiement ne s''enregistre que sur un appel émis' using errcode = 'PA001';
    end if;
    select coalesce(sum(montant) filter (where statut = 'confirme'), 0) into v_net
    from paiements where appel_id = new.appel_id;
    if v_net + new.montant > v_appel.montant_total then
      raise exception 'Le paiement dépasse le reste dû (% FCFA)', (v_appel.montant_total - v_net)::bigint
        using errcode = 'PA002';
    end if;
  else
    -- Écriture inverse : elle annule exactement un paiement de cet appel. Elle
    -- reste possible sur un appel annulé (rendre l'argent, corriger une erreur).
    select * into v_origine from paiements where id = new.annule_paiement_id;
    if not found or v_origine.annule_paiement_id is not null then
      raise exception 'Ce paiement ne peut pas être annulé' using errcode = 'PA008';
    end if;
    if v_origine.appel_id is distinct from new.appel_id
       or v_origine.proprietaire_id is distinct from new.proprietaire_id
       or new.montant <> -v_origine.montant then
      raise exception 'Une annulation reprend exactement le paiement qu''elle annule' using errcode = 'PA008';
    end if;
  end if;
  return new;
end $$;

create trigger paiements_valider
  before insert on paiements
  for each row execute function app.valider_paiement();

-- ---------------------------------------------------------------------
-- 4. Le statut de l'appel suit les paiements
-- ---------------------------------------------------------------------

create or replace function app.statut_selon_paiements(p_appel uuid)
returns statut_appel language sql stable security definer set search_path = public as $$
  select case
           when p.net <= 0 then 'emis'::statut_appel
           when p.net < a.montant_total then 'partiel'::statut_appel
           else 'solde'::statut_appel
         end
  from appels a
  cross join lateral (
    select coalesce(sum(montant) filter (where statut = 'confirme'), 0) as net
    from paiements where appel_id = a.id
  ) p
  where a.id = p_appel;
$$;

revoke all on function app.statut_selon_paiements(uuid) from public;

create or replace function app.suivre_paiement()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_statut  statut_appel;
  v_attendu statut_appel;
begin
  select statut into v_statut from appels where id = new.appel_id;
  -- Un appel annulé reste annulé, quels que soient ses paiements.
  if v_statut in ('emis', 'partiel', 'solde') then
    v_attendu := app.statut_selon_paiements(new.appel_id);
    if v_attendu is distinct from v_statut then
      update appels set statut = v_attendu where id = new.appel_id;
    end if;
  end if;
  return null;
end $$;

create trigger paiements_suivre
  after insert on paiements
  for each row execute function app.suivre_paiement();

-- app.figer_appel : reprend la définition de 20260919130000, avec trois règles de plus.
--   1. Un appel ne s'émet qu'au statut « émis » : « partiel » et « soldé » ne
--      s'atteignent que par des paiements.
--   2. Entre émis, partiel et soldé, le statut est celui que les paiements
--      donnent — personne ne le pose à la main, même par SQL direct.
--   3. Un appel qui porte des paiements ne s'annule pas : on annule d'abord
--      ses paiements (sinon de l'argent reçu resterait sans appel).
create or replace function app.figer_appel()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_immeuble uuid;
  v_net      numeric;
begin
  if tg_op = 'INSERT' then
    if new.statut <> 'brouillon' then
      raise exception 'Un appel ne s''émet que depuis un brouillon' using errcode = '23514';
    end if;
    new.instantane := null;
    return new;
  end if;

  if old.statut = 'brouillon' then
    if new.statut in ('emis', 'partiel', 'solde') then
      if new.statut <> 'emis' then
        raise exception 'Un appel s''émet au statut émis : partiel et soldé ne viennent que des paiements'
          using errcode = '23514';
      end if;

      select e.immeuble_id into v_immeuble
      from periodes p join exercices e on e.id = p.exercice_id where p.id = new.periode_id;

      if auth.uid() is not null and not app.est_gestionnaire(v_immeuble) then
        raise exception 'Émission réservée au gestionnaire et au proprietaire_org'
          using errcode = '42501';
      end if;

      -- Le budget a changé depuis la génération : les montants de cet appel ne
      -- sont plus ceux du budget. On ne les envoie pas.
      if old.obsolete then
        raise exception
          'Cet appel est obsolète : le budget a été modifié depuis sa génération. Régénérez les appels de la période avant de l''émettre'
          using errcode = '23514';
      end if;

      new.date_emission := coalesce(new.date_emission, current_date);
      new.instantane := app.instantane_appel(new);
    else
      new.instantane := null;
    end if;
    return new;
  end if;

  if old.statut = 'annule' then
    raise exception 'Un appel annulé ne se modifie plus' using errcode = '23514';
  end if;
  if new.statut = 'brouillon' then
    raise exception 'Un appel émis ne redevient pas brouillon' using errcode = '23514';
  end if;
  if (to_jsonb(new) - 'statut') is distinct from (to_jsonb(old) - 'statut') then
    raise exception
      'Un appel émis ne se modifie pas (seul son statut évolue) : annulez-le et émettez-en un autre'
      using errcode = '23514';
  end if;

  if new.statut = 'annule' then
    select coalesce(sum(montant) filter (where statut = 'confirme'), 0) into v_net
    from paiements where appel_id = new.id;
    if v_net <> 0 then
      raise exception 'Un appel qui porte des paiements ne s''annule pas : annulez d''abord ses paiements'
        using errcode = '23514';
    end if;
  elsif new.statut is distinct from old.statut
        and new.statut is distinct from app.statut_selon_paiements(new.id) then
    raise exception 'Le statut d''un appel suit ses paiements : enregistrez ou annulez un paiement'
      using errcode = '23514';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. Chaque paiement et chaque annulation laissent une trace dans `journal`
--
-- Posée par déclencheur : elle existe aussi pour un paiement inséré en SQL
-- direct. Une annulation garde, en `avant`, le paiement qu'elle annule.
-- ---------------------------------------------------------------------

create or replace function app.tracer_paiement()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_organisation uuid;
  v_avant        jsonb;
begin
  select i.organisation_id into v_organisation
  from proprietaires p join immeubles i on i.id = p.immeuble_id
  where p.id = new.proprietaire_id;

  if new.annule_paiement_id is not null then
    select to_jsonb(o) into v_avant from paiements o where o.id = new.annule_paiement_id;
  end if;

  insert into journal (organisation_id, acteur_id, acteur_libelle, entite, entite_id, action, avant, apres, cree_le)
  values (v_organisation, auth.uid(), app.libelle_acteur(), 'paiements', new.id,
          case when new.annule_paiement_id is null then 'paiement_enregistre' else 'paiement_annule' end,
          v_avant, to_jsonb(new), clock_timestamp());
  return null;
end $$;

create trigger paiements_tracer
  after insert on paiements
  for each row execute function app.tracer_paiement();

-- ---------------------------------------------------------------------
-- 6. Les deux seules voies d'écriture des utilisateurs
--
-- SECURITY DEFINER : l'utilisateur n'a plus le droit d'écrire dans `paiements`.
-- Le contrôle de périmètre est ici : gestionnaire ou proprietaire_org de
-- l'immeuble de l'appel (app.est_gestionnaire). Hors session (script, test),
-- auth.uid() est nul : pas de contrôle, comme pour l'émission d'un appel.
-- « Introuvable » et « refusé » ont le même message : on ne révèle pas
-- l'existence d'un appel d'un autre cabinet.
-- ---------------------------------------------------------------------

create or replace function public.enregistrer_paiement(
  p_appel             uuid,
  p_montant           numeric,
  p_moyen             moyen_paiement,
  p_date              date,
  p_reference_externe text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_proprietaire uuid;
  v_immeuble     uuid;
  v_id           uuid;
begin
  select a.proprietaire_id, e.immeuble_id into v_proprietaire, v_immeuble
  from appels a
  join periodes p on p.id = a.periode_id
  join exercices e on e.id = p.exercice_id
  where a.id = p_appel;

  if auth.uid() is not null and not app.est_gestionnaire(v_immeuble) then
    raise exception 'Appel introuvable, ou enregistrement réservé au gestionnaire et au proprietaire_org'
      using errcode = '42501';
  end if;
  if v_proprietaire is null then
    raise exception 'Appel introuvable' using errcode = '23503';
  end if;

  if p_moyen not in ('virement', 'virement_international', 'especes', 'wave', 'orange_money') then
    raise exception 'Moyen de règlement non pris en charge à la saisie : %', p_moyen using errcode = 'PA003';
  end if;
  if p_montant is null or p_montant <= 0 or p_montant <> round(p_montant, 2) then
    raise exception 'Montant invalide : un montant positif est attendu' using errcode = 'PA004';
  end if;
  if p_date is null or p_date > current_date then
    raise exception 'La date du paiement ne peut pas être dans le futur' using errcode = 'PA007';
  end if;

  insert into paiements (appel_id, proprietaire_id, montant, moyen, reference_externe, date_paiement)
  values (p_appel, v_proprietaire, p_montant, p_moyen,
          nullif(btrim(p_reference_externe), ''), p_date::timestamp at time zone 'UTC')
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.annuler_paiement(p_paiement uuid, p_motif text)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_origine  paiements;
  v_immeuble uuid;
  v_id       uuid;
begin
  select p.* into v_origine from paiements p where p.id = p_paiement;

  select e.immeuble_id into v_immeuble
  from appels a
  join periodes per on per.id = a.periode_id
  join exercices e on e.id = per.exercice_id
  where a.id = v_origine.appel_id;

  if auth.uid() is not null and not app.est_gestionnaire(v_immeuble) then
    raise exception 'Paiement introuvable, ou annulation réservée au gestionnaire et au proprietaire_org'
      using errcode = '42501';
  end if;
  if v_origine.id is null then
    raise exception 'Paiement introuvable' using errcode = '23503';
  end if;
  if v_origine.annule_paiement_id is not null then
    raise exception 'Une écriture d''annulation ne s''annule pas' using errcode = 'PA008';
  end if;
  if btrim(coalesce(p_motif, '')) = '' then
    raise exception 'Le motif de l''annulation est obligatoire' using errcode = 'PA006';
  end if;
  if exists (select 1 from paiements where annule_paiement_id = p_paiement) then
    raise exception 'Ce paiement est déjà annulé' using errcode = 'PA005';
  end if;

  insert into paiements (appel_id, proprietaire_id, montant, moyen, reference_externe,
                         date_paiement, annule_paiement_id, motif)
  values (v_origine.appel_id, v_origine.proprietaire_id, -v_origine.montant, v_origine.moyen,
          v_origine.reference_externe, clock_timestamp(), v_origine.id, btrim(p_motif))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.enregistrer_paiement(uuid, numeric, moyen_paiement, date, text) from public, anon;
revoke all on function public.annuler_paiement(uuid, text) from public, anon;
grant execute on function public.enregistrer_paiement(uuid, numeric, moyen_paiement, date, text) to authenticated;
grant execute on function public.annuler_paiement(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Droits : les utilisateurs lisent, n'écrivent pas
--
-- Un droit de table, pas seulement une politique : il tient même si une
-- politique était élargie un jour. Les politiques d'écriture, désormais mortes,
-- sont retirées ; la lecture (personnel du cabinet, copropriétaire pour ses
-- propres paiements) est inchangée.
-- ---------------------------------------------------------------------

revoke insert, update, delete on paiements from authenticated;

drop policy paiements_insertion_habilites on paiements;
drop policy paiements_modification_habilites on paiements;
drop policy paiements_suppression_habilites on paiements;

comment on table paiements is
  'Paiements et annulations. Immuable : une ligne enregistrée ne se modifie ni ne se supprime ; une erreur se corrige par une écriture inverse (annule_paiement_id, montant négatif, motif). Écrite par enregistrer_paiement() et annuler_paiement() seulement.';
