-- =====================================================================
-- Modalités de l'appel de fonds (décisions 71 à 74).
--
--   1. Règlement : l'article qui fixe le délai de paiement, et la règle
--      d'IMPUTATION des versements — paramètre, « sommes les plus anciennes »
--      par défaut, imprimée sur l'appel (décision 72).
--   2. Espèces : lieu et horaires de paiement, paramètre FACULTATIF qui remplace
--      l'adresse du cabinet ; intégré à l'ensemble des coordonnées de paiement,
--      donc soumis à la même double validation (décision 74).
--   3. Un moyen annoncé sans ses coordonnées n'est pas un moyen : contrainte sur
--      les coordonnées en vigueur et sur les versions proposées, et émission
--      refusée sinon (décision 74).
--   4. Instantané version 3 : situation du compte à la date d'édition (solde
--      antérieur détaillé, décision 71), modalités (délai, imputation), lieu des
--      espèces.
--   5. La date limite de règlement : calculée et stockée PAR DESTINATAIRE au
--      moment de l'envoi — date d'envoi + délai du règlement (art. 16) — jamais
--      imprimée sur le PDF figé (décision 73).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Règlement : délai et imputation
-- ---------------------------------------------------------------------

create type imputation_paiements as enum ('plus_anciennes', 'designee_par_le_coproprietaire');

alter table reglements
  add column article_delai_paiement text,
  add column imputation_paiements imputation_paiements not null default 'plus_anciennes',
  add column article_imputation text;

comment on column reglements.imputation_paiements is
  'Comment un versement s''impute : sur les sommes les plus anciennes (défaut), sauf si le règlement en dispose autrement. Imprimé sur l''appel.';

-- ---------------------------------------------------------------------
-- 2. Lieu et horaires des espèces, dans l'ensemble versionné
-- ---------------------------------------------------------------------

alter table immeubles
  add column especes_lieu text,
  add column especes_horaires text;
alter table coordonnees_paiement_versions
  add column especes_lieu text,
  add column especes_horaires text;

comment on column immeubles.especes_lieu is
  'Où payer en espèces. Facultatif : à défaut, l''adresse du cabinet (organisations.adresse). Coordonnée de paiement : soumise à double validation.';

-- L'instantané d'un jeu de coordonnées porte désormais le lieu des espèces.
-- L'ancienne signature est retirée : deux versions rendraient les appels ambigus.
drop function app.snapshot_paiement(text, text, text, text, moyen_paiement[], jsonb);
create function app.snapshot_paiement(
  p_titulaire text, p_banque text, p_numero text, p_bic text,
  p_moyens moyen_paiement[], p_numeros jsonb,
  p_especes_lieu text default null, p_especes_horaires text default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'compte_titulaire', nullif(btrim(p_titulaire), ''),
    'compte_banque',    nullif(btrim(p_banque), ''),
    'compte_numero',    nullif(btrim(p_numero), ''),
    'compte_bic',       nullif(btrim(p_bic), ''),
    'moyens_paiement_acceptes', to_jsonb(p_moyens),
    'numeros_marchands', p_numeros,
    'especes_lieu',     nullif(btrim(p_especes_lieu), ''),
    'especes_horaires', nullif(btrim(p_especes_horaires), '')
  );
$$;

create or replace function app.coordonnees_paiement(i immeubles)
returns jsonb language sql immutable as $$
  select app.snapshot_paiement(
    i.compte_titulaire, i.compte_banque, i.compte_numero, i.compte_bic,
    i.moyens_paiement_acceptes, i.numeros_marchands, i.especes_lieu, i.especes_horaires);
$$;

create or replace function app.coordonnees_paiement_vides(i immeubles)
returns boolean language sql immutable as $$
  select app.coordonnees_paiement(i) = jsonb_build_object(
    'compte_titulaire', null, 'compte_banque', null, 'compte_numero', null,
    'compte_bic', null, 'moyens_paiement_acceptes', '[]'::jsonb, 'numeros_marchands', '{}'::jsonb,
    'especes_lieu', null, 'especes_horaires', null);
$$;

-- ---------------------------------------------------------------------
-- 3. Chaque moyen annoncé porte ses coordonnées
--
--   virement, virement international, chèque : le compte du syndicat
--     (titulaire, banque, numéro ; le BIC pour l'international, déjà exigé) ;
--   Wave, Orange Money : leur numéro marchand ;
--   espèces : toujours un lieu — le paramètre dédié, sinon l'adresse du cabinet
--     (vérifié à l'émission, où l'adresse du cabinet est connue).
-- ---------------------------------------------------------------------

create or replace function app.moyens_avec_coordonnees(
  p_moyens moyen_paiement[], p_titulaire text, p_banque text, p_numero text, p_numeros jsonb)
returns boolean language sql immutable as $$
  select not exists (
    select 1 from unnest(coalesce(p_moyens, '{}')) m
    where (m in ('virement', 'virement_international', 'cheque')
           and (nullif(btrim(p_titulaire), '') is null
                or nullif(btrim(p_banque), '') is null
                or nullif(btrim(p_numero), '') is null))
       or (m in ('wave', 'orange_money')
           and nullif(btrim(coalesce(p_numeros, '{}'::jsonb) ->> m::text), '') is null)
  );
$$;

-- `not valid` : toute nouvelle écriture est contrôlée ; une base qui annoncerait
-- déjà un moyen sans coordonnées ne bloque pas la migration, mais n'émet plus.
alter table immeubles
  add constraint immeubles_moyens_avec_coordonnees
    check (app.moyens_avec_coordonnees(moyens_paiement_acceptes, compte_titulaire, compte_banque,
                                       compte_numero, numeros_marchands)) not valid;
alter table coordonnees_paiement_versions
  add constraint versions_moyens_avec_coordonnees
    check (app.moyens_avec_coordonnees(moyens_paiement_acceptes, compte_titulaire, compte_banque,
                                       compte_numero, numeros_marchands)) not valid;

-- Ce qui conditionne l'émission : le compte du syndicat, chaque moyen avec ses
-- coordonnées, et un lieu pour les espèces si elles sont acceptées.
create or replace function app.modalites_paiement_completes(p_immeuble uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select app.coordonnees_bancaires_completes(i.id)
     and cardinality(i.moyens_paiement_acceptes) > 0
     and app.moyens_avec_coordonnees(i.moyens_paiement_acceptes, i.compte_titulaire, i.compte_banque,
                                     i.compte_numero, i.numeros_marchands)
     and ('especes' <> all (i.moyens_paiement_acceptes)
          or coalesce(nullif(btrim(i.especes_lieu), ''), nullif(btrim(o.adresse), '')) is not null)
  from immeubles i join organisations o on o.id = i.organisation_id
  where i.id = p_immeuble;
$$;
revoke all on function app.modalites_paiement_completes(uuid) from public;
grant execute on function app.modalites_paiement_completes(uuid) to authenticated;

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
  if not app.modalites_paiement_completes(v_immeuble) then
    raise exception
      'Émission impossible : chaque moyen de paiement annoncé doit porter ses coordonnées (numéro marchand, compte, lieu des espèces)'
      using errcode = '23514';
  end if;
  return new;
end $$;

-- Proposer : deux paramètres de plus (lieu et horaires des espèces), facultatifs.
drop function public.proposer_coordonnees_paiement(uuid, text, text, text, text, moyen_paiement[], jsonb);
drop function app.proposer_coordonnees_paiement(uuid, text, text, text, text, moyen_paiement[], jsonb);

create function app.proposer_coordonnees_paiement(
  p_immeuble uuid, p_titulaire text, p_banque text, p_numero text, p_bic text,
  p_moyens moyen_paiement[], p_numeros jsonb,
  p_especes_lieu text default null, p_especes_horaires text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_immeuble immeubles;
  v_actuel   jsonb;
  v_propose  jsonb;
  v_id       uuid;
  v_libelle  text := app.libelle_acteur();
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;

  -- Verrou sur l'immeuble : sérialise propositions et confirmations.
  select * into v_immeuble from immeubles where id = p_immeuble for update;
  if not found or not app.est_gestionnaire(p_immeuble) then
    raise exception 'Non autorisé : modification réservée au gestionnaire et au proprietaire_org'
      using errcode = '42501';
  end if;

  v_actuel  := app.coordonnees_paiement(v_immeuble);
  v_propose := app.snapshot_paiement(p_titulaire, p_banque, p_numero, p_bic,
                                     coalesce(p_moyens, '{}'), coalesce(p_numeros, '{}'::jsonb),
                                     p_especes_lieu, p_especes_horaires);
  if v_propose = v_actuel then
    raise exception 'Aucun changement : ces coordonnées sont déjà celles en vigueur'
      using errcode = '22023';
  end if;

  -- Une nouvelle proposition remplace celle qui attendait (une seule à la fois).
  update coordonnees_paiement_versions
     set statut = 'remplacee', decide_par = auth.uid(), decide_par_libelle = v_libelle,
         decide_le = clock_timestamp()
   where immeuble_id = p_immeuble and statut = 'en_attente';

  insert into coordonnees_paiement_versions (
    immeuble_id, compte_titulaire, compte_banque, compte_numero, compte_bic,
    moyens_paiement_acceptes, numeros_marchands, especes_lieu, especes_horaires,
    propose_par, propose_par_libelle)
  values (
    p_immeuble, nullif(btrim(p_titulaire), ''), nullif(btrim(p_banque), ''),
    nullif(btrim(p_numero), ''), nullif(btrim(p_bic), ''),
    coalesce(p_moyens, '{}'), coalesce(p_numeros, '{}'::jsonb),
    nullif(btrim(p_especes_lieu), ''), nullif(btrim(p_especes_horaires), ''),
    auth.uid(), v_libelle)
  returning id into v_id;

  insert into journal (organisation_id, acteur_id, acteur_libelle, entite, entite_id, action, avant, apres, cree_le)
  values (v_immeuble.organisation_id, auth.uid(), v_libelle, 'immeubles', p_immeuble,
          'coordonnees_paiement_proposees', v_actuel, v_propose, clock_timestamp());

  return v_id;
end $$;

create function public.proposer_coordonnees_paiement(
  p_immeuble uuid, p_titulaire text, p_banque text, p_numero text, p_bic text,
  p_moyens moyen_paiement[], p_numeros jsonb,
  p_especes_lieu text default null, p_especes_horaires text default null)
returns uuid language sql security invoker set search_path = public, app as $$
  select app.proposer_coordonnees_paiement(p_immeuble, p_titulaire, p_banque, p_numero, p_bic,
                                           p_moyens, p_numeros, p_especes_lieu, p_especes_horaires);
$$;

revoke all on function app.proposer_coordonnees_paiement(uuid, text, text, text, text, moyen_paiement[], jsonb, text, text) from public;
revoke all on function public.proposer_coordonnees_paiement(uuid, text, text, text, text, moyen_paiement[], jsonb, text, text) from public;
grant execute on function app.proposer_coordonnees_paiement(uuid, text, text, text, text, moyen_paiement[], jsonb, text, text) to authenticated;
grant execute on function public.proposer_coordonnees_paiement(uuid, text, text, text, text, moyen_paiement[], jsonb, text, text) to authenticated;

-- Confirmer : copie aussi le lieu des espèces dans les coordonnées en vigueur.
create or replace function app.confirmer_coordonnees_paiement(p_version uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  v         coordonnees_paiement_versions;
  v_immeuble uuid;
  v_libelle text := app.libelle_acteur();
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;

  select immeuble_id into v_immeuble from coordonnees_paiement_versions where id = p_version;
  if v_immeuble is null then
    raise exception 'Version introuvable' using errcode = 'P0002';
  end if;

  perform 1 from immeubles where id = v_immeuble for update;
  select * into v from coordonnees_paiement_versions where id = p_version for update;

  if not app.est_gestionnaire(v.immeuble_id) then
    raise exception 'Non autorisé : confirmation réservée au gestionnaire et au proprietaire_org'
      using errcode = '42501';
  end if;
  if v.statut <> 'en_attente' then
    raise exception 'Cette modification n''est plus en attente de confirmation' using errcode = '22023';
  end if;
  if v.propose_par is not null and v.propose_par = auth.uid() then
    raise exception 'L''auteur d''une modification ne peut pas la confirmer : un autre membre habilité du cabinet doit le faire'
      using errcode = '42501';
  end if;

  update coordonnees_paiement_versions
     set statut = 'remplacee', decide_par = auth.uid(), decide_par_libelle = v_libelle,
         decide_le = clock_timestamp()
   where immeuble_id = v.immeuble_id and statut = 'en_vigueur';

  update immeubles
     set compte_titulaire = v.compte_titulaire, compte_banque = v.compte_banque,
         compte_numero = v.compte_numero, compte_bic = v.compte_bic,
         moyens_paiement_acceptes = v.moyens_paiement_acceptes,
         numeros_marchands = v.numeros_marchands,
         especes_lieu = v.especes_lieu, especes_horaires = v.especes_horaires
   where id = v.immeuble_id;

  update coordonnees_paiement_versions
     set statut = 'en_vigueur', decide_par = auth.uid(), decide_par_libelle = v_libelle,
         decide_le = clock_timestamp()
   where id = p_version;
end $$;

-- Refuser : la trace porte aussi le lieu des espèces proposé.
create or replace function app.refuser_coordonnees_paiement(p_version uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  v          coordonnees_paiement_versions;
  v_i        immeubles;
  v_immeuble uuid;
  v_libelle  text := app.libelle_acteur();
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;

  select immeuble_id into v_immeuble from coordonnees_paiement_versions where id = p_version;
  if v_immeuble is null then
    raise exception 'Version introuvable' using errcode = 'P0002';
  end if;

  select * into v_i from immeubles where id = v_immeuble for update;
  select * into v from coordonnees_paiement_versions where id = p_version for update;

  if not app.est_gestionnaire(v.immeuble_id) then
    raise exception 'Non autorisé' using errcode = '42501';
  end if;
  if v.statut <> 'en_attente' then
    raise exception 'Cette modification n''est plus en attente' using errcode = '22023';
  end if;

  update coordonnees_paiement_versions
     set statut = 'refusee', decide_par = auth.uid(), decide_par_libelle = v_libelle,
         decide_le = clock_timestamp()
   where id = p_version;

  insert into journal (organisation_id, acteur_id, acteur_libelle, entite, entite_id, action, avant, apres, cree_le)
  values (v_i.organisation_id, auth.uid(), v_libelle, 'immeubles', v.immeuble_id,
          'coordonnees_paiement_refusees', app.coordonnees_paiement(v_i),
          app.snapshot_paiement(v.compte_titulaire, v.compte_banque, v.compte_numero, v.compte_bic,
                                v.moyens_paiement_acceptes, v.numeros_marchands,
                                v.especes_lieu, v.especes_horaires),
          clock_timestamp());
end $$;

-- ---------------------------------------------------------------------
-- 4. Instantané, version 3
-- ---------------------------------------------------------------------

create or replace function app.instantane_appel(a appels)
returns jsonb language sql volatile security definer set search_path = public, app as $$
  with postes as (
    select bl.poste_charge_id,
           bl.montant as montant_poste,
           c.libelle as cle_libelle,
           (select sum(q.base_calcul) from app.quote_part(bl.poste_charge_id, bl.montant) q) as base_totale
    from budget_lignes bl
    join postes_charges pc on pc.id = bl.poste_charge_id
    join cles_repartition c on c.id = pc.cle_repartition_id
    where bl.periode_id = a.periode_id
      and bl.poste_charge_id in (select poste_charge_id from appel_lignes where appel_id = a.id)
  ),
  -- Ce que le destinataire doit encore, au moment de l'édition, sur ses AUTRES
  -- appels émis. Information datée : l'appel ne porte que sur la période, et
  -- report_anterieur n'est jamais utilisé pour reporter un arriéré (décision 71).
  anterieurs as (
    select o.reference, per2.libelle as periode, o.date_echeance,
           o.montant_total - coalesce((select sum(pa.montant) from paiements pa
                                       where pa.appel_id = o.id and pa.statut = 'confirme'), 0) as reste
    from appels o join periodes per2 on per2.id = o.periode_id
    where o.proprietaire_id = a.proprietaire_id and o.id <> a.id and o.statut in ('emis', 'partiel')
  )
  select jsonb_build_object(
    'version', 3,
    'emis_le', clock_timestamp(),
    'reference', a.reference,
    'numero', a.numero,
    'date_echeance', a.date_echeance,
    'date_emission', a.date_emission,
    'report_anterieur', a.report_anterieur,
    'montant_total', a.montant_total,
    'destinataire', jsonb_build_object('id', p.id, 'nom', p.nom, 'email', p.email),
    'periode', jsonb_build_object('id', per.id, 'libelle', per.libelle),
    'immeuble', jsonb_build_object(
      'id', i.id, 'nom', i.nom, 'code_reference', i.code_reference,
      'adresse', i.adresse, 'ville', i.ville),
    'gestionnaire', jsonb_build_object('nom', i.gestionnaire_nom, 'email', i.gestionnaire_email),
    'organisation', jsonb_build_object(
      'nom', o.nom, 'adresse', o.adresse, 'email', o.email, 'ninea', o.ninea, 'rccm', o.rccm),
    'lots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'numero', l.numero, 'designation', l.designation,
               'niveau', l.niveau, 'tantiemes', l.tantiemes)
             order by l.numero)
      from lots l
      where l.id in (select lot_id from appel_lignes where appel_id = a.id)), '[]'::jsonb),
    'lignes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'lot_numero', l.numero,
               'poste_libelle', pc.libelle,
               'cle_libelle', po.cle_libelle,
               'base_calcul', al.base_calcul,
               'base_totale', po.base_totale,
               'montant_poste', po.montant_poste,
               'montant', al.montant)
             order by l.numero, pc.ordre, al.id)
      from appel_lignes al
      join lots l on l.id = al.lot_id
      join postes_charges pc on pc.id = al.poste_charge_id
      left join postes po on po.poste_charge_id = al.poste_charge_id
      where al.appel_id = a.id), '[]'::jsonb),
    'reglement', jsonb_build_object(
      'compte', case when app.coordonnees_bancaires_completes(i.id) then
                  jsonb_build_object(
                    'titulaire', btrim(i.compte_titulaire),
                    'banque', btrim(i.compte_banque),
                    'numero', btrim(i.compte_numero),
                    'bic', nullif(btrim(i.compte_bic), ''))
                end,
      'moyens', to_jsonb(i.moyens_paiement_acceptes),
      'numeros_marchands', i.numeros_marchands,
      'compte_modifie_le', i.compte_modifie_le,
      -- Où payer en espèces : le paramètre dédié, sinon l'adresse du cabinet.
      'especes', jsonb_build_object(
        'lieu', coalesce(nullif(btrim(i.especes_lieu), ''), o.adresse),
        'horaires', nullif(btrim(i.especes_horaires), ''),
        'lieu_du_cabinet', nullif(btrim(i.especes_lieu), '') is null)),
    'retard', (
      select jsonb_build_object(
               'taux_penalite', r.taux_penalite,
               'penalite_par', r.penalite_par,
               'requiert_mise_en_demeure', r.penalite_requiert_mise_en_demeure,
               'delai_paiement_jours', r.delai_paiement_jours,
               'article', r.article_retard)
      from reglements r where r.immeuble_id = i.id and r.en_vigueur),
    'modalites', (
      select jsonb_build_object(
               'delai_paiement_jours', r.delai_paiement_jours,
               'article_delai', r.article_delai_paiement,
               'imputation', r.imputation_paiements,
               'article_imputation', r.article_imputation)
      from reglements r where r.immeuble_id = i.id and r.en_vigueur),
    'situation', jsonb_build_object(
      'solde_anterieur', coalesce((select sum(reste) from anterieurs where reste > 0), 0),
      'appels', coalesce((
        select jsonb_agg(jsonb_build_object('reference', reference, 'periode', periode, 'reste', reste)
                         order by date_echeance, reference)
        from anterieurs where reste > 0), '[]'::jsonb))
  )
  from proprietaires p, periodes per, exercices e, immeubles i, organisations o
  where p.id = a.proprietaire_id
    and per.id = a.periode_id
    and e.id = per.exercice_id
    and i.id = e.immeuble_id
    and o.id = i.organisation_id;
$$;

revoke all on function app.instantane_appel(appels) from public;

comment on column appels.report_anterieur is
  'Jamais utilisé pour reporter un arriéré dans un appel (décision 71) : l''arriéré resterait dû sur son appel d''origine et serait compté deux fois. Le solde antérieur figure sur le document comme information datée (instantané, « situation »).';

-- ---------------------------------------------------------------------
-- 5. La date limite de règlement, fixée à l'envoi
-- ---------------------------------------------------------------------

create table dates_limites_appels (
  appel_id     uuid primary key references appels(id) on delete cascade,
  immeuble_id  uuid not null references immeubles(id) on delete cascade,
  -- Jour de l'envoi réussi qui l'a fixée, et date limite = envoi + délai.
  envoye_le    date not null,
  date_limite  date not null check (date_limite >= envoye_le),
  fixee_par    uuid references auth.users(id) on delete set null,
  fixee_le     timestamptz not null default now()
);

comment on table dates_limites_appels is
  'Date limite de règlement de chaque appel : jour du PREMIER envoi réussi + délai du règlement (art. 16). Un renvoi ne la déplace pas. C''est elle que le tableau de bord utilise pour le retard.';

alter table dates_limites_appels enable row level security;
alter table dates_limites_appels force row level security;
create policy dates_limites_lecture_personnel on dates_limites_appels for select
  using (immeuble_id in (select app.immeubles_de_lutilisateur()));
revoke insert, update, delete on dates_limites_appels from authenticated, anon;

-- Le délai de l'appel : celui de son instantané (figé à l'émission), sinon le
-- règlement en vigueur.
create or replace function app.delai_paiement_appel(p_appel uuid)
returns integer language sql stable security definer set search_path = public, app as $$
  select coalesce(
    (a.instantane -> 'modalites' ->> 'delai_paiement_jours')::int,
    (a.instantane -> 'retard' ->> 'delai_paiement_jours')::int,
    (select r.delai_paiement_jours from reglements r where r.immeuble_id = e.immeuble_id and r.en_vigueur))
  from appels a join periodes per on per.id = a.periode_id join exercices e on e.id = per.exercice_id
  where a.id = p_appel;
$$;
revoke all on function app.delai_paiement_appel(uuid) from public;

-- La date limite qu'aurait un envoi fait aujourd'hui : celle déjà fixée par un
-- envoi précédent, sinon aujourd'hui + délai. Ne fixe rien : le courriel
-- l'annonce, puis la trace de l'envoi réussi l'enregistre.
create or replace function public.date_limite_si_envoye(p_appel uuid)
returns date language sql stable security definer set search_path = public, app as $$
  select coalesce(
    (select d.date_limite from dates_limites_appels d where d.appel_id = p_appel),
    current_date + app.delai_paiement_appel(p_appel))
  where exists (
    select 1 from appels a join periodes per on per.id = a.periode_id join exercices e on e.id = per.exercice_id
    where a.id = p_appel and app.est_gestionnaire(e.immeuble_id));
$$;
revoke all on function public.date_limite_si_envoye(uuid) from public, anon;
grant execute on function public.date_limite_si_envoye(uuid) to authenticated;

-- La trace de l'envoi fixe la date limite au premier envoi réussi. La date
-- annoncée par le courriel (p_date_limite) doit être celle que la base calcule :
-- ce qui est stocké est ce qui a été écrit au copropriétaire.
drop function public.tracer_envoi_appel(uuid, text, text, text, boolean, jsonb);

create function public.tracer_envoi_appel(
  p_appel uuid,
  p_canal text,
  p_adresse text,
  p_adresse_prevue text,
  p_reussi boolean,
  p_resultat jsonb,
  p_date_limite date default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_immeuble     uuid;
  v_organisation uuid;
  v_reference    text;
  v_id           uuid;
  v_attendue     date;
begin
  select e.immeuble_id, i.organisation_id, a.reference into v_immeuble, v_organisation, v_reference
  from appels a
  join periodes per on per.id = a.periode_id
  join exercices e on e.id = per.exercice_id
  join immeubles i on i.id = e.immeuble_id
  where a.id = p_appel;

  if auth.uid() is null or not app.est_gestionnaire(v_immeuble) then
    raise exception 'Envoi réservé au gestionnaire et au proprietaire_org' using errcode = '42501';
  end if;
  if p_canal not in ('email') then
    raise exception 'Canal d''envoi inconnu : %', p_canal using errcode = '22023';
  end if;

  if p_reussi then
    v_attendue := coalesce(
      (select date_limite from dates_limites_appels where appel_id = p_appel),
      current_date + app.delai_paiement_appel(p_appel));
    if p_date_limite is not null and p_date_limite <> v_attendue then
      raise exception 'Date limite annoncée (%) différente de celle du règlement (%)', p_date_limite, v_attendue
        using errcode = '22023';
    end if;
    insert into dates_limites_appels (appel_id, immeuble_id, envoye_le, date_limite, fixee_par)
    values (p_appel, v_immeuble, current_date, v_attendue, auth.uid())
    on conflict (appel_id) do nothing;
  end if;

  insert into journal (organisation_id, acteur_id, acteur_libelle, entite, entite_id, action, avant, apres, cree_le)
  values (v_organisation, auth.uid(), app.libelle_acteur(), 'appels', p_appel,
          case when p_reussi then 'appel_envoye' else 'appel_envoi_echoue' end,
          null,
          jsonb_build_object(
            'reference', v_reference,
            'canal', p_canal,
            'adresse', p_adresse,
            'adresse_prevue', p_adresse_prevue,
            'redirige', p_adresse_prevue is not null and p_adresse_prevue is distinct from p_adresse,
            'date_limite', case when p_reussi then v_attendue end,
            'resultat', coalesce(p_resultat, '{}'::jsonb)),
          clock_timestamp())
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.tracer_envoi_appel(uuid, text, text, text, boolean, jsonb, date) from public, anon;
grant execute on function public.tracer_envoi_appel(uuid, text, text, text, boolean, jsonb, date) to authenticated;
