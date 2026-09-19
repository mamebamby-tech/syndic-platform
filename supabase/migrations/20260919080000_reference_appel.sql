-- =====================================================================
-- Référence d'appel : courte, dictable, saisissable dans un virement.
--
-- Avant : `<libellé de période>-<8 caractères d'UUID>`, soit
-- « 4e trimestre 2026-8f6436c5 » — une espace, un fragment d'identifiant
-- technique, impossible à dicter au téléphone ou à recopier sans faute
-- dans le libellé d'un virement.
--
-- Après : `MT-2026T4-007`.
--
--   {code}     code court de l'immeuble (`immeubles.code_reference`)
--   {annee}    année de début de la période
--   {periode}  T4 (trimestriel), M10, S2, A — selon la périodicité du
--              règlement en vigueur et le début de la période
--   {seq}      numéro d'ordre de l'appel dans la période, sur 3 chiffres
--
-- Le gabarit est un PARAMÈTRE de l'immeuble (`format_reference_appel`),
-- pas une constante : un autre cabinet peut préférer `TOUR-{annee}-{seq}`.
--
-- Pourquoi un séquentiel et non le numéro de lot. Un appel est adressé à
-- un PROPRIÉTAIRE, jamais à un lot (CLAUDE.md règle n°3) : un propriétaire de
-- 22 lots reçoit un seul appel, donc n'a pas « un » numéro de lot, et une
-- mutation de lot changerait la référence d'un appel déjà émis.
--
-- Unicité : par période (`unique (periode_id, reference)`). Le numéro
-- d'ordre est conservé (`appels.numero`) pour que la régénération d'une
-- période — qui supprime et recrée les brouillons — n'attribue jamais un
-- numéro déjà porté par un appel émis.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Paramètres de l'immeuble
-- ---------------------------------------------------------------------

alter table immeubles
  add column code_reference text
    constraint immeubles_code_reference_format check (code_reference ~ '^[A-Z0-9]{1,8}$'),
  add column format_reference_appel text not null default '{code}-{annee}{periode}-{seq}'
    constraint immeubles_format_reference_valide check (
      -- `{seq}` obligatoire : c'est lui qui rend la référence unique.
      position('{seq}' in format_reference_appel) > 0
      -- Hors jetons, uniquement des caractères dictables : jamais d'espace.
      and regexp_replace(format_reference_appel, '\{(code|annee|periode|seq)\}', '', 'g')
          ~ '^[A-Za-z0-9_-]*$'
    ),
  add constraint immeubles_code_reference_unique unique (organisation_id, code_reference);

-- Donnée du jeu de référence (voir aussi supabase/seed/seed.sql) : sans
-- code, la génération des appels échoue plutôt que d'en inventer un.
update immeubles set code_reference = 'MT'
where nom = 'Mamelles Tower' and code_reference is null;

-- ---------------------------------------------------------------------
-- 2. Numéro d'ordre et unicité par période
-- ---------------------------------------------------------------------

alter table appels add column numero integer;

-- Les références historiques (avec espace et fragment d'UUID) sont
-- remplacées. Seuls des brouillons existent : rien n'a été émis. Un appel
-- non brouillon à l'ancien format ferait échouer la contrainte ci-dessous —
-- volontairement : on ne réécrit jamais la référence d'un document émis.
update appels set reference = 'TMP-' || id::text where statut = 'brouillon';

alter table appels
  add constraint appels_reference_dictable check (reference ~ '^[A-Za-z0-9_-]+$'),
  add constraint appels_reference_unique_par_periode unique (periode_id, reference),
  add constraint appels_numero_unique_par_periode unique (periode_id, numero);

-- ---------------------------------------------------------------------
-- 3. Code de période et attribution des références
-- ---------------------------------------------------------------------

-- Code de présentation, pas une règle juridique : les lettres n'ont aucun
-- effet sur un délai, un taux ou une échéance.
create or replace function app.code_periode(p_periodicite periodicite, p_debut date)
returns text language sql immutable as $$
  select case p_periodicite
    when 'mensuel'     then 'M' || lpad(extract(month from p_debut)::int::text, 2, '0')
    when 'trimestriel' then 'T' || ((extract(month from p_debut)::int - 1) / 3 + 1)::text
    when 'semestriel'  then 'S' || ((extract(month from p_debut)::int - 1) / 6 + 1)::text
    when 'annuel'      then 'A'
  end;
$$;

-- Attribue numéro et référence aux appels de la période qui n'en ont pas
-- encore (numero is null). Ordre : plus petit numéro de lot du
-- destinataire, puis son nom — déterministe, donc une régénération à
-- données égales redonne les mêmes références.
create or replace function app.attribuer_references(p_periode_id uuid)
returns integer language plpgsql security definer set search_path = public, app as $$
declare
  v_code     text;
  v_format   text;
  v_annee    text;
  v_periode  text;
  v_base     integer;
  v_nb       integer;
begin
  select i.code_reference, i.format_reference_appel,
         extract(year from p.date_debut)::int::text,
         app.code_periode(r.periodicite_appel, p.date_debut)
    into v_code, v_format, v_annee, v_periode
  from periodes p
  join exercices e on e.id = p.exercice_id
  join immeubles i on i.id = e.immeuble_id
  left join reglements r on r.immeuble_id = i.id and r.en_vigueur
  where p.id = p_periode_id;

  if not found then
    raise exception 'Période introuvable : %', p_periode_id;
  end if;
  if v_code is null then
    raise exception 'Code de référence non renseigné pour cet immeuble (immeubles.code_reference)';
  end if;
  if v_periode is null then
    raise exception 'Aucun règlement en vigueur : périodicité inconnue, référence impossible';
  end if;

  select coalesce(max(numero), 0) into v_base from appels where periode_id = p_periode_id;

  with classes as (
    select a.id,
           row_number() over (
             order by (select min(l.numero)
                       from appel_lignes al join lots l on l.id = al.lot_id
                       where al.appel_id = a.id),
                      p.nom, a.id
           ) as rang
    from appels a
    join proprietaires p on p.id = a.proprietaire_id
    where a.periode_id = p_periode_id and a.numero is null
  )
  update appels a
     set numero = v_base + c.rang,
         reference = replace(replace(replace(replace(v_format,
                       '{code}', v_code),
                       '{annee}', v_annee),
                       '{periode}', v_periode),
                       '{seq}', lpad((v_base + c.rang)::text, 3, '0'))
    from classes c
   where a.id = c.id;

  get diagnostics v_nb = row_count;
  return v_nb;
end $$;

revoke all on function app.attribuer_references(uuid) from public;

-- ---------------------------------------------------------------------
-- 4. Génération : références attribuées après insertion
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

  delete from appels where periode_id = p_periode_id and statut = 'brouillon';

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

    -- Référence provisoire : la vraie n'existe qu'une fois tous les appels
    -- de la période créés, car son numéro d'ordre en dépend.
    insert into appels (periode_id, proprietaire_id, reference, date_echeance, statut)
    values (p_periode_id, v_dest, 'TMP-' || gen_random_uuid()::text, v_echeance, 'brouillon')
    on conflict (periode_id, proprietaire_id) do nothing;

    select id into v_appel_id from appels
    where periode_id = p_periode_id and proprietaire_id = v_dest;

    insert into appel_lignes (appel_id, lot_id, poste_charge_id, base_calcul, montant)
    values (v_appel_id, r.lot_id, r.poste_charge_id, r.base_calcul, r.part);
  end loop;

  perform app.attribuer_references(p_periode_id);

  update appels a
     set montant_total = coalesce((select sum(montant) from appel_lignes l where l.appel_id = a.id), 0)
                         + a.report_anterieur
   where a.periode_id = p_periode_id;

  select count(*) into v_nb from appels where periode_id = p_periode_id;
  return v_nb;
end $$;

-- ---------------------------------------------------------------------
-- 5. Références des brouillons existants
-- ---------------------------------------------------------------------

do $$
declare v_periode uuid;
begin
  for v_periode in select distinct periode_id from appels where numero is null loop
    perform app.attribuer_references(v_periode);
  end loop;
end $$;

comment on column immeubles.code_reference is
  'Code court de l''immeuble dans la référence d''un appel (MT). Unique par cabinet.';
comment on column immeubles.format_reference_appel is
  'Gabarit de la référence d''appel. Jetons : {code} {annee} {periode} {seq}. '
  '{seq} obligatoire ; aucun caractère hors A-Z a-z 0-9 _ - ; jamais d''espace.';
comment on column appels.numero is
  'Numéro d''ordre dans la période, conservé à la régénération pour ne jamais réutiliser un numéro émis.';
