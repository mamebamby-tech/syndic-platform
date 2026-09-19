-- =====================================================================
-- Paramètres de l'immeuble : coordonnées de paiement, moyens acceptés,
-- format de la référence — modifiables par le personnel habilité, et
-- toute modification des coordonnées de paiement TRACÉE.
--
-- Pourquoi c'est sensible. Un IBAN ou un numéro marchand modifié par la
-- mauvaise personne redirige l'argent de 19 copropriétaires vers un autre
-- compte, sans qu'aucun calcul ne soit faux. Trois garde-fous, tous en
-- base — une route oubliée dans l'application ne les contourne pas :
--   1. QUI peut modifier : le gestionnaire et le proprietaire_org, pas le
--      lecteur (RLS) ;
--   2. chaque modification laisse une trace dans `journal` : avant, après,
--      auteur, date (déclencheur) ;
--   3. les copropriétaires voient la date de la dernière modification sur
--      l'appel (`immeubles.compte_modifie_le`, posée par déclencheur : elle
--      ne se saisit pas).
--
-- « Coordonnées de paiement » = compte du syndicat (titulaire, banque,
-- numéro, code SWIFT/BIC), moyens de paiement acceptés et numéros marchands.
-- Les numéros marchands en font partie : les changer détourne des paiements
-- aussi sûrement qu'un IBAN.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Journal : l'auteur survit à la suppression de son compte
--
-- `acteur_id` référençait auth.users sans `on delete`, ce qui interdisait de
-- supprimer un compte ayant agi. On garde la ligne (c'est une trace) et on
-- perd le lien ; `acteur_libelle` conserve QUI c'était (courriel ou numéro
-- au moment de l'action).
-- ---------------------------------------------------------------------

alter table journal add column acteur_libelle text;

alter table journal
  drop constraint journal_acteur_id_fkey,
  add constraint journal_acteur_id_fkey
    foreign key (acteur_id) references auth.users(id) on delete set null;

-- Le journal n'a qu'une politique, de lecture (journal_lecture) : aucun
-- utilisateur ne peut y écrire, modifier ni supprimer. Seuls les
-- déclencheurs ci-dessous écrivent (SECURITY DEFINER). Ne pas ajouter de
-- politique d'écriture : une trace que l'on peut effacer n'en est pas une.

-- ---------------------------------------------------------------------
-- 2. Colonnes et contraintes
-- ---------------------------------------------------------------------

alter table immeubles
  -- Numéro marchand par moyen de paiement mobile : {"wave": "...", "orange_money": "..."}.
  add column numeros_marchands jsonb not null default '{}'::jsonb,
  -- Date de la dernière modification des coordonnées de paiement. Posée par
  -- déclencheur, jamais saisie : les copropriétaires la voient sur l'appel.
  add column compte_modifie_le timestamptz;

create or replace function app.numeros_marchands_valides(p_moyens moyen_paiement[], p_numeros jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_numeros) = 'object'
     and not exists (
       select 1 from jsonb_each(p_numeros) e
       where e.key not in ('wave', 'orange_money')            -- moyens mobiles seulement
          or e.key <> all (p_moyens::text[])                  -- ...et acceptés
          or jsonb_typeof(e.value) <> 'string'
          or btrim(e.value #>> '{}') = ''
     );
$$;

alter table immeubles
  add constraint immeubles_numeros_marchands_valides
    check (app.numeros_marchands_valides(moyens_paiement_acceptes, numeros_marchands)),
  -- Format ISO 9362 : 8 ou 11 caractères alphanumériques. Norme bancaire
  -- internationale, pas une règle du règlement.
  add constraint immeubles_bic_format
    check (compte_bic is null or compte_bic ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  -- On n'annonce pas les virements internationaux sans le code qu'ils exigent.
  add constraint immeubles_swift_requis
    check ('virement_international' <> all (moyens_paiement_acceptes)
           or nullif(btrim(compte_bic), '') is not null);

-- ---------------------------------------------------------------------
-- 3. Qui peut modifier un immeuble
--
-- `immeubles_syndic` (for all) laissait TOUT membre du cabinet — lecteur
-- compris — écrire dans l'immeuble, donc dans ses coordonnées bancaires.
-- Lecture : tout le personnel. Modification : gestionnaire et
-- proprietaire_org. Création et suppression : proprietaire_org seul.
-- ---------------------------------------------------------------------

drop policy immeubles_syndic on immeubles;

create policy immeubles_lecture_personnel on immeubles for select
  using (organisation_id in (select app.organisations_de_lutilisateur()));

create policy immeubles_modification on immeubles for update
  using (app.est_gestionnaire(id))
  with check (app.est_gestionnaire(id)
              and organisation_id in (select app.organisations_de_lutilisateur()));

-- Le copropriétaire lit SON immeuble — donc où payer, et quand cela a changé.
-- La politique d'origine (20260918090100_rls.sql) interrogeait `proprietaires`
-- SOUS RLS : or un copropriétaire n'a aucune politique de lecture sur cette
-- table, la sous-requête était toujours vide, et il ne voyait AUCUN immeuble.
-- Une fonction SECURITY DEFINER lit `proprietaires` à sa place.
--
-- Les autres politiques `*_coproprietaire` (lots, règlement, postes...) ont le
-- même défaut : voir docs/06-decisions.md, chantiers différés. Elles n'ont pas
-- été touchées ici : élargir en lecture dix tables est une décision à part.
create or replace function app.immeubles_du_coproprietaire()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.immeuble_id from proprietaires p
  where p.id in (select app.proprietaires_de_lutilisateur());
$$;

drop policy immeubles_coproprietaire on immeubles;
create policy immeubles_coproprietaire on immeubles for select
  using (id in (select app.immeubles_du_coproprietaire()));

create policy immeubles_creation on immeubles for insert
  with check (app.est_proprietaire_org(organisation_id));

create policy immeubles_suppression on immeubles for delete
  using (app.est_proprietaire_org(organisation_id));

-- ---------------------------------------------------------------------
-- 4. Instantané, date de modification, trace
-- ---------------------------------------------------------------------

-- Ce qui est tracé. Chaînes normalisées (vide = absent) : ajouter une
-- espace ou vider un champ déjà vide n'est pas une modification.
create or replace function app.coordonnees_paiement(i immeubles)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'compte_titulaire', nullif(btrim(i.compte_titulaire), ''),
    'compte_banque',    nullif(btrim(i.compte_banque), ''),
    'compte_numero',    nullif(btrim(i.compte_numero), ''),
    'compte_bic',       nullif(btrim(i.compte_bic), ''),
    'moyens_paiement_acceptes', to_jsonb(i.moyens_paiement_acceptes),
    'numeros_marchands', i.numeros_marchands
  );
$$;

create or replace function app.coordonnees_paiement_vides(i immeubles)
returns boolean language sql immutable as $$
  select app.coordonnees_paiement(i) = jsonb_build_object(
    'compte_titulaire', null, 'compte_banque', null, 'compte_numero', null,
    'compte_bic', null, 'moyens_paiement_acceptes', '[]'::jsonb, 'numeros_marchands', '{}'::jsonb);
$$;

-- Qui agit : courriel ou numéro du compte, au moment de l'action.
create or replace function app.libelle_acteur()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(u.email, ''), nullif(u.phone, ''))
  from auth.users u where u.id = auth.uid();
$$;

-- Date : posée ici, jamais saisie. Une date forgée est écrasée.
create or replace function app.horodater_coordonnees()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.compte_modifie_le := case when app.coordonnees_paiement_vides(new) then null else clock_timestamp() end;
  elsif app.coordonnees_paiement(new) is distinct from app.coordonnees_paiement(old) then
    -- clock_timestamp() : l'instant réel du changement, pas celui du début de
    -- la transaction (now()), qui confondrait deux modifications successives.
    new.compte_modifie_le := clock_timestamp();
  else
    new.compte_modifie_le := old.compte_modifie_le;
  end if;
  return new;
end $$;

create trigger immeubles_horodater_coordonnees
  before insert or update on immeubles
  for each row execute function app.horodater_coordonnees();

-- Trace : une ligne de journal par modification, avec l'état complet avant
-- et après. `auth.uid()` est nul hors d'une session (script, migration) : la
-- trace existe quand même, sans auteur.
create or replace function app.tracer_immeuble()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_avant jsonb;
  v_apres jsonb;
begin
  v_apres := app.coordonnees_paiement(new);
  v_avant := case when tg_op = 'UPDATE' then app.coordonnees_paiement(old) end;

  if (tg_op = 'INSERT' and not app.coordonnees_paiement_vides(new))
     or (tg_op = 'UPDATE' and v_avant is distinct from v_apres) then
    insert into journal (organisation_id, acteur_id, acteur_libelle, entite, entite_id, action, avant, apres, cree_le)
    values (new.organisation_id, auth.uid(), app.libelle_acteur(), 'immeubles', new.id,
            'coordonnees_paiement_modifiees', v_avant, v_apres, clock_timestamp());
  end if;

  if tg_op = 'UPDATE'
     and (old.code_reference is distinct from new.code_reference
          or old.format_reference_appel is distinct from new.format_reference_appel) then
    insert into journal (organisation_id, acteur_id, acteur_libelle, entite, entite_id, action, avant, apres, cree_le)
    values (new.organisation_id, auth.uid(), app.libelle_acteur(), 'immeubles', new.id,
            'format_reference_modifie',
            jsonb_build_object('code_reference', old.code_reference,
                               'format_reference_appel', old.format_reference_appel),
            jsonb_build_object('code_reference', new.code_reference,
                               'format_reference_appel', new.format_reference_appel),
            clock_timestamp());
  end if;

  return null;
end $$;

create trigger immeubles_tracer
  after insert or update on immeubles
  for each row execute function app.tracer_immeuble();

revoke all on function app.libelle_acteur() from public;

comment on column immeubles.numeros_marchands is
  'Numéro marchand par moyen mobile (wave, orange_money), pour un moyen accepté. Fait partie des coordonnées de paiement : tracé.';
comment on column immeubles.compte_modifie_le is
  'Dernière modification des coordonnées de paiement. Posée par déclencheur, jamais saisie ; visible des copropriétaires sur l''appel.';
comment on column journal.acteur_libelle is
  'Courriel ou numéro de l''auteur au moment de l''action : la trace reste lisible si le compte est supprimé.';
