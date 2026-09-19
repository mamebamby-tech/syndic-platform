-- =====================================================================
-- Modalités de règlement : coordonnées bancaires du syndicat et moyens
-- acceptés, portés par l'immeuble.
--
-- Le document d'appel doit dire où et comment payer. Le compte bancaire du
-- syndicat n'existe pas encore (question n°1, docs/06-decisions.md) : les
-- colonnes sont donc vides, le document affiche un emplacement explicite
-- « Coordonnées bancaires à renseigner », et — c'est l'objet du déclencheur
-- ci-dessous — AUCUN appel ne peut être émis tant qu'elles le sont.
--
-- Colonnes sur `immeubles` et non nouvelle table : le syndicat est celui de
-- l'immeuble, et les politiques existantes (`immeubles_syndic` en écriture,
-- `immeubles_coproprietaire` en lecture — le copropriétaire doit voir où
-- payer) couvrent déjà ces colonnes, avec un `with check` aussi strict que
-- leur `using`.
--
-- « Renseigné » : titulaire, banque et numéro de compte non vides. Le
-- numéro est un IBAN ou un RIB : aucun format n'est imposé, il varie selon
-- la banque et le pays. Le BIC est facultatif (virements internationaux).
-- =====================================================================

alter table immeubles
  add column compte_titulaire text,
  add column compte_banque    text,
  add column compte_numero    text,
  add column compte_bic       text,
  -- Moyens de règlement acceptés. Vide = à renseigner (aucun moyen inventé).
  add column moyens_paiement_acceptes moyen_paiement[] not null default '{}';

create or replace function app.coordonnees_bancaires_completes(p_immeuble uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select nullif(btrim(compte_titulaire), '') is not null
       and nullif(btrim(compte_banque), '')    is not null
       and nullif(btrim(compte_numero), '')    is not null
    from immeubles where id = p_immeuble
  ), false);
$$;

revoke all on function app.coordonnees_bancaires_completes(uuid) from public;
grant execute on function app.coordonnees_bancaires_completes(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Pas d'émission sans coordonnées bancaires
--
-- Un appel passe de `brouillon` à un statut émis (emis, partiel, solde) :
-- c'est l'émission. Le contrôle vit en base et non dans l'écran : une seule
-- route oubliée dans l'application suffirait à envoyer à 19 copropriétaires
-- un appel sans indication de paiement. `annule` reste possible — on doit
-- pouvoir écarter un brouillon.
-- ---------------------------------------------------------------------

create or replace function app.verifier_emission_appel()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_immeuble uuid;
begin
  if new.statut not in ('emis', 'partiel', 'solde') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.statut = new.statut then
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

create trigger appels_verifier_emission
  before insert or update of statut on appels
  for each row execute function app.verifier_emission_appel();

comment on column immeubles.compte_numero is
  'IBAN ou RIB du compte du syndicat. Vide tant que le compte n''existe pas : émission des appels bloquée.';
comment on column immeubles.moyens_paiement_acceptes is
  'Moyens de règlement acceptés, affichés sur l''appel. Vide = à renseigner.';
