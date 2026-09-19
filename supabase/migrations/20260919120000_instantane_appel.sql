-- =====================================================================
-- Instantané d'un appel à l'émission : un appel émis est un document
-- ENVOYÉ, il ne change plus jamais.
--
-- Avant : le document d'un appel se rendait depuis les données courantes
-- (coordonnées bancaires de l'immeuble, libellés des postes, nom du
-- copropriétaire, identité du cabinet...). Un IBAN modifié APRÈS l'envoi
-- changeait, rétroactivement, le document que 19 copropriétaires avaient
-- déjà reçu : plus personne ne pouvait dire ce qui leur avait été demandé.
--
-- Maintenant, au passage de brouillon à émis, la base fige sur l'appel
-- (`appels.instantane`) une copie de TOUT ce que le document affiche :
-- référence, dates, destinataire, lignes, montants, identité du cabinet,
-- coordonnées bancaires, moyens de paiement, numéros marchands. Le document
-- d'un appel émis se rend EXCLUSIVEMENT depuis cette copie.
--
-- Et un appel émis ne se modifie plus : la base refuse tout changement, hors
-- son statut (voir plus bas). Pour corriger un appel émis, on l'annule et on
-- en émet un autre — comme pour une facture.
--
-- Tout vit dans des déclencheurs : aucune route de l'application, oubliée ou
-- future, ne peut émettre sans figer, ni modifier après coup.
-- =====================================================================

alter table appels add column instantane jsonb;

-- ---------------------------------------------------------------------
-- 1. La copie
-- ---------------------------------------------------------------------

-- Tout ce que le document affiche (components/documents/document-appel.tsx),
-- et rien qui dépende de l'écran. Numérotée : le format pourra évoluer sans
-- rendre illisibles les instantanés déjà pris.
create or replace function app.instantane_appel(a appels)
returns jsonb language sql volatile security definer set search_path = public, app as $$
  select jsonb_build_object(
    'version', 1,
    'emis_le', clock_timestamp(),
    'reference', a.reference,
    'numero', a.numero,
    'date_echeance', a.date_echeance,
    'date_emission', a.date_emission,
    'report_anterieur', a.report_anterieur,
    'montant_total', a.montant_total,
    'destinataire', jsonb_build_object('id', p.id, 'nom', p.nom),
    'periode', jsonb_build_object('id', per.id, 'libelle', per.libelle),
    'immeuble', jsonb_build_object('id', i.id, 'nom', i.nom),
    'organisation', jsonb_build_object(
      'nom', o.nom, 'adresse', o.adresse, 'email', o.email, 'ninea', o.ninea, 'rccm', o.rccm),
    'lignes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'lot_numero', l.numero,
               'poste_libelle', pc.libelle,
               'base_calcul', al.base_calcul,
               'montant', al.montant)
             order by l.numero, pc.ordre, al.id)
      from appel_lignes al
      join lots l on l.id = al.lot_id
      join postes_charges pc on pc.id = al.poste_charge_id
      where al.appel_id = a.id), '[]'::jsonb),
    'reglement', jsonb_build_object(
      -- Même définition de « renseigné » que app.coordonnees_bancaires_completes.
      'compte', case when app.coordonnees_bancaires_completes(i.id) then
                  jsonb_build_object(
                    'titulaire', btrim(i.compte_titulaire),
                    'banque', btrim(i.compte_banque),
                    'numero', btrim(i.compte_numero),
                    'bic', nullif(btrim(i.compte_bic), ''))
                end,
      'moyens', to_jsonb(i.moyens_paiement_acceptes),
      'numeros_marchands', i.numeros_marchands,
      'compte_modifie_le', i.compte_modifie_le)
  )
  from proprietaires p, periodes per, exercices e, immeubles i, organisations o
  where p.id = a.proprietaire_id
    and per.id = a.periode_id
    and e.id = per.exercice_id
    and i.id = e.immeuble_id
    and o.id = i.organisation_id;
$$;

revoke all on function app.instantane_appel(appels) from public;

-- ---------------------------------------------------------------------
-- 2. Les états d'un appel
--
--   brouillon → émis : figé (instantané pris, date d'émission posée) ;
--   émis / partiel / soldé : rien ne change, SAUF le statut, qui suit les
--     paiements (émis → partiel → soldé) et peut aller à « annulé » ;
--   annulé : terminal ;
--   jamais de retour à « brouillon ».
--
-- Le statut n'est pas gelé : un paiement partiel doit pouvoir être constaté.
-- Tout le reste — montants, lignes, référence, dates, destinataire,
-- instantané — l'est.
-- ---------------------------------------------------------------------

create or replace function app.figer_appel()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_immeuble uuid;
begin
  if tg_op = 'INSERT' then
    -- Un appel naît brouillon : ses lignes n'existent pas encore, il n'y a
    -- rien à figer.
    if new.statut <> 'brouillon' then
      raise exception 'Un appel ne s''émet que depuis un brouillon' using errcode = '23514';
    end if;
    new.instantane := null;
    return new;
  end if;

  if old.statut = 'brouillon' then
    if new.statut in ('emis', 'partiel', 'solde') then
      select e.immeuble_id into v_immeuble
      from periodes p join exercices e on e.id = p.exercice_id where p.id = new.periode_id;

      -- Émettre engage le cabinet : gestionnaire ou proprietaire_org. Hors
      -- session (script, migration) auth.uid() est nul : pas de contrôle.
      if auth.uid() is not null and not app.est_gestionnaire(v_immeuble) then
        raise exception 'Émission réservée au gestionnaire et au proprietaire_org'
          using errcode = '42501';
      end if;

      new.date_emission := coalesce(new.date_emission, current_date);
      new.instantane := app.instantane_appel(new);
    else
      -- Un brouillon (ou un brouillon annulé) n'a pas d'instantané : impossible
      -- d'en fabriquer un à la main.
      new.instantane := null;
    end if;
    return new;
  end if;

  -- Déjà émis, ou annulé.
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
  return new;
end $$;

create trigger appels_figer
  before insert or update on appels
  for each row execute function app.figer_appel();

-- Supprimer un appel émis est refusé. Exception : la suppression en cascade de
-- sa période (donc de l'exercice, de l'immeuble) — rien ne subsiste alors à
-- protéger, et on doit pouvoir supprimer un cabinet de test.
create or replace function app.refuser_suppression_appel_emis()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.instantane is not null
     and exists (select 1 from periodes where id = old.periode_id) then
    raise exception 'Un appel émis ne se supprime pas : annulez-le' using errcode = '23514';
  end if;
  return old;
end $$;

create trigger appels_refuser_suppression_emis
  before delete on appels
  for each row execute function app.refuser_suppression_appel_emis();

-- Les lignes d'un appel émis sont figées aussi : elles sont ce que le document
-- affiche.
create or replace function app.figer_lignes_appel()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_appel uuid;
  v_fige  boolean;
begin
  for v_appel in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.appel_id end,
      case when tg_op <> 'DELETE' then new.appel_id end]) as x
    where x is not null
  loop
    select instantane is not null into v_fige from appels where id = v_appel;
    -- Appel introuvable : il est en cours de suppression en cascade (brouillon).
    if coalesce(v_fige, false) then
      raise exception 'Les lignes d''un appel émis ne se modifient pas' using errcode = '23514';
    end if;
  end loop;
  return coalesce(new, old);
end $$;

create trigger appel_lignes_figer
  before insert or update or delete on appel_lignes
  for each row execute function app.figer_lignes_appel();

alter table appels
  add constraint appels_instantane_requis_si_emis
  check (statut not in ('emis', 'partiel', 'solde') or instantane is not null);

-- ---------------------------------------------------------------------
-- 2 bis. Un seul appel ACTIF par destinataire et par période
--
-- « Annulez-le et émettez-en un autre » n'est possible que si l'appel annulé
-- ne bloque pas la place du nouveau. L'unicité (periode_id, proprietaire_id)
-- devient donc partielle : elle ne vise que les appels non annulés.
-- ---------------------------------------------------------------------

alter table appels drop constraint appels_periode_id_proprietaire_id_key;
create unique index appels_un_actif_par_proprietaire
  on appels (periode_id, proprietaire_id) where statut <> 'annule';

-- ---------------------------------------------------------------------
-- 3. La vérification des coordonnées bancaires ne vaut qu'à l'ÉMISSION
--
-- Elle se déclenchait à chaque changement de statut vers émis, partiel ou
-- soldé : un paiement partiel aurait été refusé si les coordonnées avaient
-- changé depuis l'envoi.
-- ---------------------------------------------------------------------

create or replace function app.verifier_emission_appel()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_immeuble uuid;
begin
  if new.statut not in ('emis', 'partiel', 'solde') then
    return new;
  end if;
  -- Seul le passage brouillon → émis est une émission.
  if tg_op = 'UPDATE' and old.statut <> 'brouillon' then
    return new;
  end if;

  select e.immeuble_id into v_immeuble
  from periodes p join exercices e on e.id = p.exercice_id
  where p.id = new.periode_id;

  if not app.coordonnees_bancaires_completes(v_immeuble) then
    raise exception
      'Émission impossible : coordonnées bancaires du syndicat à renseigner (immeubles.compte_*)'
      using errcode = '23514';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4. Régénérer une période ne touche jamais un appel émis
--
-- L'ancienne version ajoutait des lignes à l'appel existant du destinataire
-- (`on conflict do nothing`, puis insertion) et recalculait le total de TOUS
-- les appels de la période : après émission, elle aurait modifié un appel
-- envoyé. Maintenant : seuls les brouillons (et les brouillons annulés,
-- sans instantané) sont recréés ; un destinataire déjà servi par un appel
-- émis est sauté ; seuls les nouveaux totaux sont recalculés.
-- ---------------------------------------------------------------------

create or replace function app.generer_appels(p_periode_id uuid)
returns integer language plpgsql security definer set search_path = public, app as $$
declare
  v_immeuble   uuid;
  v_echeance   date;
  v_nb         integer := 0;
  r            record;
  v_appel_id   uuid;
  v_dest       uuid;
begin
  select e.immeuble_id, p.date_echeance
    into v_immeuble, v_echeance
  from periodes p join exercices e on e.id = p.exercice_id
  where p.id = p_periode_id;

  if v_immeuble is null then
    raise exception 'Période introuvable : %', p_periode_id;
  end if;

  delete from appels where periode_id = p_periode_id and instantane is null;

  for r in
    select bl.poste_charge_id, bl.montant, q.lot_id, q.base_calcul, q.montant as part
    from budget_lignes bl
    cross join lateral app.quote_part(bl.poste_charge_id, bl.montant) q
    where bl.periode_id = p_periode_id and bl.montant > 0 and q.montant > 0
  loop
    v_dest := app.destinataire_du_lot(r.lot_id, v_echeance);
    if v_dest is null then
      raise warning 'Lot % sans propriétaire actif : ignoré', r.lot_id;
      continue;
    end if;

    -- Ce destinataire a déjà un appel émis (non annulé) pour la période : on
    -- n'y touche pas. Un appel émis puis annulé, lui, laisse la place à un nouveau.
    if exists (select 1 from appels
               where periode_id = p_periode_id and proprietaire_id = v_dest
                 and instantane is not null and statut <> 'annule') then
      continue;
    end if;

    insert into appels (periode_id, proprietaire_id, reference, date_echeance, statut)
    values (p_periode_id, v_dest, 'TMP-' || gen_random_uuid()::text, v_echeance, 'brouillon')
    on conflict (periode_id, proprietaire_id) where statut <> 'annule' do nothing;

    select id into v_appel_id from appels
    where periode_id = p_periode_id and proprietaire_id = v_dest and statut = 'brouillon';

    insert into appel_lignes (appel_id, lot_id, poste_charge_id, base_calcul, montant)
    values (v_appel_id, r.lot_id, r.poste_charge_id, r.base_calcul, r.part);
  end loop;

  perform app.attribuer_references(p_periode_id);

  update appels a
     set montant_total = coalesce((select sum(montant) from appel_lignes l where l.appel_id = a.id), 0)
                         + a.report_anterieur
   where a.periode_id = p_periode_id and a.instantane is null;

  select count(*) into v_nb from appels where periode_id = p_periode_id;
  return v_nb;
end $$;

comment on column appels.instantane is
  'Copie figée de tout ce que le document affiche, prise au passage de brouillon à émis. Le document d''un appel émis se rend exclusivement depuis elle.';
