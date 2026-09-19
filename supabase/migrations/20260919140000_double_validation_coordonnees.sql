-- =====================================================================
-- Double validation des coordonnées de paiement.
--
-- Modifier les coordonnées bancaires, les moyens acceptés ou un numéro
-- marchand ne les change PAS : cela crée une version EN ATTENTE, qui n'entre en
-- vigueur qu'après confirmation par un AUTRE membre habilité du cabinet que son
-- auteur. Jusque-là, les appels utilisent l'ancienne version.
--
-- Pourquoi : la trace (20260919110000) dit APRÈS coup qui a détourné l'argent
-- des copropriétaires. La double validation empêche que ce soit possible avec
-- un seul compte compromis, ou un seul membre malveillant ou distrait.
--
-- Comment. Les colonnes `immeubles.compte_*`, `moyens_paiement_acceptes` et
-- `numeros_marchands` restent la version EN VIGUEUR : tout ce qui existe
-- (émission, instantané, document, dashboard) continue de les lire, et de
-- fait utilise l'ancienne version tant qu'une nouvelle n'est pas confirmée.
-- Les modifications passent par la table des versions et trois fonctions
-- SECURITY DEFINER (proposer, confirmer, refuser).
--
-- Ce n'est pas contournable par un simple UPDATE : les utilisateurs perdent le
-- DROIT d'écrire ces colonnes (droit de colonne). Un droit de colonne tient même
-- si une politique était élargie un jour.
--
-- « Habilité » = gestionnaire ou proprietaire_org. Si le cabinet n'en compte
-- qu'un, aucune modification ne peut être confirmée : la règle n'est PAS
-- contournée — l'application le signale, et c'est une décision à prendre
-- (docs/06-decisions.md).
--
-- Périmètre : le compte, les moyens acceptés ET les numéros marchands forment un
-- seul ensemble versionné. Les numéros marchands sont liés aux moyens acceptés
-- par contrainte ; les versionner séparément produirait des états incohérents.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Instantané d'un jeu de coordonnées (partagé par la version en vigueur et
--    les propositions)
-- ---------------------------------------------------------------------

create or replace function app.snapshot_paiement(
  p_titulaire text, p_banque text, p_numero text, p_bic text,
  p_moyens moyen_paiement[], p_numeros jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'compte_titulaire', nullif(btrim(p_titulaire), ''),
    'compte_banque',    nullif(btrim(p_banque), ''),
    'compte_numero',    nullif(btrim(p_numero), ''),
    'compte_bic',       nullif(btrim(p_bic), ''),
    'moyens_paiement_acceptes', to_jsonb(p_moyens),
    'numeros_marchands', p_numeros
  );
$$;

create or replace function app.coordonnees_paiement(i immeubles)
returns jsonb language sql immutable as $$
  select app.snapshot_paiement(
    i.compte_titulaire, i.compte_banque, i.compte_numero, i.compte_bic,
    i.moyens_paiement_acceptes, i.numeros_marchands);
$$;

-- ---------------------------------------------------------------------
-- 2. Les versions
-- ---------------------------------------------------------------------

create type statut_version_paiement as enum ('en_attente', 'en_vigueur', 'remplacee', 'refusee');

create table coordonnees_paiement_versions (
  id                       uuid primary key default gen_random_uuid(),
  immeuble_id              uuid not null references immeubles(id) on delete cascade,
  statut                   statut_version_paiement not null default 'en_attente',

  compte_titulaire         text,
  compte_banque            text,
  compte_numero            text,
  compte_bic               text,
  moyens_paiement_acceptes moyen_paiement[] not null default '{}',
  numeros_marchands        jsonb not null default '{}'::jsonb,

  propose_par              uuid references auth.users(id) on delete set null,
  propose_par_libelle      text,
  propose_le               timestamptz not null default clock_timestamp(),
  -- Qui a confirmé, refusé ou remplacé, et quand.
  decide_par               uuid references auth.users(id) on delete set null,
  decide_par_libelle       text,
  decide_le                timestamptz,

  -- Mêmes contraintes de cohérence que les colonnes en vigueur : une proposition
  -- invalide est refusée à la proposition, pas à la confirmation.
  constraint versions_numeros_marchands_valides
    check (app.numeros_marchands_valides(moyens_paiement_acceptes, numeros_marchands)),
  constraint versions_bic_format
    check (compte_bic is null or compte_bic ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  constraint versions_swift_requis
    check ('virement_international' <> all (moyens_paiement_acceptes)
           or nullif(btrim(compte_bic), '') is not null),
  constraint versions_decision_datee
    check (statut = 'en_attente' or decide_le is not null),
  -- L'auteur d'une modification ne la confirme pas. Vérifié ICI aussi, pas
  -- seulement dans la fonction : la règle tient même par SQL direct. (Auteur ou
  -- confirmateur dont le compte a été supprimé : le lien est nul, rien à comparer.)
  constraint versions_auteur_ne_confirme_pas
    check (statut <> 'en_vigueur' or propose_par is null or decide_par is null or decide_par <> propose_par)
);

-- Au plus une version en attente et une en vigueur par immeuble.
create unique index versions_une_en_attente on coordonnees_paiement_versions (immeuble_id) where statut = 'en_attente';
create unique index versions_une_en_vigueur on coordonnees_paiement_versions (immeuble_id) where statut = 'en_vigueur';
create index on coordonnees_paiement_versions (immeuble_id, propose_le desc);

-- Sécurité par ligne : lecture par le personnel du cabinet ; AUCUNE politique
-- d'écriture — seules les fonctions ci-dessous écrivent. (Table rattachée à un
-- immeuble : `immeuble_id`, règle n°2.)
alter table coordonnees_paiement_versions enable row level security;
alter table coordonnees_paiement_versions force row level security;

create policy versions_lecture_personnel on coordonnees_paiement_versions for select
  using (immeuble_id in (select app.immeubles_de_lutilisateur()));

revoke insert, update, delete on coordonnees_paiement_versions from authenticated;

-- ---------------------------------------------------------------------
-- 3. Les utilisateurs n'écrivent plus les coordonnées en vigueur
--
-- Droit de colonne : tout SAUF compte_*, moyens_paiement_acceptes,
-- numeros_marchands et compte_modifie_le. Les fonctions, SECURITY DEFINER,
-- écrivent avec les droits du propriétaire. Toute nouvelle colonne d'immeuble
-- qui doit être modifiable depuis l'application doit être ajoutée à ce GRANT.
-- ---------------------------------------------------------------------

revoke insert, update on immeubles from authenticated;
grant insert (id, organisation_id, nom, adresse, ville, pays, titre_foncier, devise,
              code_reference, format_reference_appel) on immeubles to authenticated;
grant update (organisation_id, nom, adresse, ville, pays, titre_foncier, devise,
              code_reference, format_reference_appel) on immeubles to authenticated;

-- ---------------------------------------------------------------------
-- 4. Proposer, confirmer, refuser
-- ---------------------------------------------------------------------

create or replace function app.proposer_coordonnees_paiement(
  p_immeuble uuid, p_titulaire text, p_banque text, p_numero text, p_bic text,
  p_moyens moyen_paiement[], p_numeros jsonb)
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
                                     coalesce(p_moyens, '{}'), coalesce(p_numeros, '{}'::jsonb));
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
    moyens_paiement_acceptes, numeros_marchands, propose_par, propose_par_libelle)
  values (
    p_immeuble, nullif(btrim(p_titulaire), ''), nullif(btrim(p_banque), ''),
    nullif(btrim(p_numero), ''), nullif(btrim(p_bic), ''),
    coalesce(p_moyens, '{}'), coalesce(p_numeros, '{}'::jsonb), auth.uid(), v_libelle)
  returning id into v_id;

  insert into journal (organisation_id, acteur_id, acteur_libelle, entite, entite_id, action, avant, apres, cree_le)
  values (v_immeuble.organisation_id, auth.uid(), v_libelle, 'immeubles', p_immeuble,
          'coordonnees_paiement_proposees', v_actuel, v_propose, clock_timestamp());

  return v_id;
end $$;

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

  -- Verrou de l'immeuble d'abord (même ordre que proposer), puis relecture de la
  -- version : si elle a été remplacée entre-temps, on le voit.
  perform 1 from immeubles where id = v_immeuble for update;
  select * into v from coordonnees_paiement_versions where id = p_version for update;

  if not app.est_gestionnaire(v.immeuble_id) then
    raise exception 'Non autorisé : confirmation réservée au gestionnaire et au proprietaire_org'
      using errcode = '42501';
  end if;
  if v.statut <> 'en_attente' then
    raise exception 'Cette modification n''est plus en attente de confirmation' using errcode = '22023';
  end if;
  -- LA règle : un AUTRE membre que l'auteur.
  if v.propose_par is not null and v.propose_par = auth.uid() then
    raise exception 'L''auteur d''une modification ne peut pas la confirmer : un autre membre habilité du cabinet doit le faire'
      using errcode = '42501';
  end if;

  update coordonnees_paiement_versions
     set statut = 'remplacee', decide_par = auth.uid(), decide_par_libelle = v_libelle,
         decide_le = clock_timestamp()
   where immeuble_id = v.immeuble_id and statut = 'en_vigueur';

  -- Entrée en vigueur. Les déclencheurs de l'immeuble posent la date de
  -- modification et écrivent la trace (« coordonnees_paiement_modifiees »), avec
  -- pour auteur celui qui CONFIRME.
  update immeubles
     set compte_titulaire = v.compte_titulaire, compte_banque = v.compte_banque,
         compte_numero = v.compte_numero, compte_bic = v.compte_bic,
         moyens_paiement_acceptes = v.moyens_paiement_acceptes,
         numeros_marchands = v.numeros_marchands
   where id = v.immeuble_id;

  update coordonnees_paiement_versions
     set statut = 'en_vigueur', decide_par = auth.uid(), decide_par_libelle = v_libelle,
         decide_le = clock_timestamp()
   where id = p_version;
end $$;

-- Refuser (un autre membre) ou retirer (l'auteur) : la version est écartée, les
-- coordonnées en vigueur ne changent pas.
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
                                v.moyens_paiement_acceptes, v.numeros_marchands),
          clock_timestamp());
end $$;

-- ---------------------------------------------------------------------
-- 5. Enveloppes publiques et droits (PostgREST n'expose que `public`)
-- ---------------------------------------------------------------------

create or replace function public.proposer_coordonnees_paiement(
  p_immeuble uuid, p_titulaire text, p_banque text, p_numero text, p_bic text,
  p_moyens moyen_paiement[], p_numeros jsonb)
returns uuid language sql security invoker set search_path = public, app as $$
  select app.proposer_coordonnees_paiement(p_immeuble, p_titulaire, p_banque, p_numero, p_bic, p_moyens, p_numeros);
$$;

create or replace function public.confirmer_coordonnees_paiement(p_version uuid)
returns void language sql security invoker set search_path = public, app as $$
  select app.confirmer_coordonnees_paiement(p_version);
$$;

create or replace function public.refuser_coordonnees_paiement(p_version uuid)
returns void language sql security invoker set search_path = public, app as $$
  select app.refuser_coordonnees_paiement(p_version);
$$;

revoke all on function app.proposer_coordonnees_paiement(uuid, text, text, text, text, moyen_paiement[], jsonb) from public;
revoke all on function app.confirmer_coordonnees_paiement(uuid) from public;
revoke all on function app.refuser_coordonnees_paiement(uuid) from public;
revoke all on function public.proposer_coordonnees_paiement(uuid, text, text, text, text, moyen_paiement[], jsonb) from public;
revoke all on function public.confirmer_coordonnees_paiement(uuid) from public;
revoke all on function public.refuser_coordonnees_paiement(uuid) from public;

grant execute on function app.proposer_coordonnees_paiement(uuid, text, text, text, text, moyen_paiement[], jsonb) to authenticated;
grant execute on function app.confirmer_coordonnees_paiement(uuid) to authenticated;
grant execute on function app.refuser_coordonnees_paiement(uuid) to authenticated;
grant execute on function public.proposer_coordonnees_paiement(uuid, text, text, text, text, moyen_paiement[], jsonb) to authenticated;
grant execute on function public.confirmer_coordonnees_paiement(uuid) to authenticated;
grant execute on function public.refuser_coordonnees_paiement(uuid) to authenticated;

comment on table coordonnees_paiement_versions is
  'Versions des coordonnées de paiement. Une version en attente n''entre en vigueur qu''après confirmation par un AUTRE membre habilité que son auteur ; les colonnes immeubles.compte_* sont la version en vigueur.';
