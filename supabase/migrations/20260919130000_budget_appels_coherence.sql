-- =====================================================================
-- Cohérence entre le budget et les appels.
--
-- Trois règles, toutes en base : l'écran peut les rappeler, il ne les porte pas.
--
-- 1. Si le budget est modifié APRÈS la génération, les appels en brouillon de la
--    période sont marqués OBSOLÈTES : ils ne reflètent plus le budget.
-- 2. Un brouillon obsolète ne peut pas être émis : la base refuse, tant que les
--    appels n'ont pas été régénérés.
-- 3. Une fois des appels émis, le budget de la période est VERROUILLÉ. (La
--    correction passera par un appel complémentaire ou un avoir : chantier
--    différé, docs/06-decisions.md — rien n'est construit ici.)
--
-- Sans (2), rien n'empêche d'envoyer à 19 copropriétaires des montants calculés
-- sur un budget qui n'existe plus. Sans (3), le budget d'une période déjà
-- appelée pourrait changer sous les appels émis, sans trace de ce qui a été
-- appelé sur quelle base.
-- =====================================================================

alter table appels add column obsolete boolean not null default false;

-- ---------------------------------------------------------------------
-- 1. Marquer les brouillons obsolètes
--
-- Ce qui rend un appel obsolète, c'est ce qui change les MONTANTS appelés : un
-- montant de `budget_lignes` qui s'ajoute, disparaît ou change, ou la clé de
-- répartition d'un poste. Un enregistrement qui remet les mêmes valeurs (l'écran
-- renvoie toutes les lignes à chaque sauvegarde), ou une note de fournisseur
-- modifiée, n'en fait pas partie : marquer alors serait du bruit, et
-- apprendrait à ignorer l'alerte.
-- ---------------------------------------------------------------------

create or replace function app.marquer_appels_obsoletes(p_periode uuid)
returns void language sql security definer set search_path = public as $$
  update appels set obsolete = true
  where periode_id = p_periode and statut = 'brouillon' and instantane is null and not obsolete;
$$;

revoke all on function app.marquer_appels_obsoletes(uuid) from public;

create or replace function app.budget_modifie()
returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if tg_op = 'INSERT' then
    if new.montant > 0 then perform app.marquer_appels_obsoletes(new.periode_id); end if;
  elsif tg_op = 'DELETE' then
    if old.montant > 0 then perform app.marquer_appels_obsoletes(old.periode_id); end if;
  else
    if old.montant is distinct from new.montant
       or old.poste_charge_id is distinct from new.poste_charge_id
       or old.periode_id is distinct from new.periode_id then
      perform app.marquer_appels_obsoletes(old.periode_id);
      perform app.marquer_appels_obsoletes(new.periode_id);
    end if;
  end if;
  return null;
end $$;

create trigger budget_lignes_marquer_obsoletes
  after insert or update or delete on budget_lignes
  for each row execute function app.budget_modifie();

-- La clé de répartition d'un poste s'applique à toutes les périodes de
-- l'immeuble : ses brouillons deviennent tous obsolètes.
create or replace function app.cle_de_poste_modifiee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.cle_repartition_id is distinct from new.cle_repartition_id then
    update appels set obsolete = true
    where statut = 'brouillon' and instantane is null and not obsolete
      and periode_id in (
        select p.id from periodes p join exercices e on e.id = p.exercice_id
        where e.immeuble_id = new.immeuble_id);
  end if;
  return null;
end $$;

create trigger postes_charges_cle_marquer_obsoletes
  after update on postes_charges
  for each row execute function app.cle_de_poste_modifiee();

-- ---------------------------------------------------------------------
-- 2. Émettre un brouillon obsolète est refusé
--
-- Ajouté à app.figer_appel (20260919120000) : même déclencheur, même passage
-- brouillon → émis.
-- ---------------------------------------------------------------------

create or replace function app.figer_appel()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_immeuble uuid;
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
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Le budget d'une période avec des appels émis est verrouillé
--
-- « Émis » = un instantané existe et l'appel n'est pas annulé : si tous les
-- appels émis sont annulés, plus rien n'est appelé sur cette base et le budget
-- se rouvre. Exception : la suppression en cascade de la période elle-même.
-- ---------------------------------------------------------------------

create or replace function app.verrouiller_budget()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_periode uuid;
begin
  for v_periode in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.periode_id end,
      case when tg_op <> 'DELETE' then new.periode_id end]) as x
    where x is not null
  loop
    if exists (select 1 from periodes where id = v_periode)
       and exists (select 1 from appels
                   where periode_id = v_periode and instantane is not null and statut <> 'annule') then
      raise exception
        'Le budget de cette période est verrouillé : des appels ont été émis. Toute correction passe par un appel complémentaire ou un avoir'
        using errcode = '23514';
    end if;
  end loop;
  return coalesce(new, old);
end $$;

create trigger budget_lignes_verrouiller
  before insert or update or delete on budget_lignes
  for each row execute function app.verrouiller_budget();

-- ---------------------------------------------------------------------
-- 4. Ce qu'un utilisateur peut écrire dans `appels`
--
-- `appels_syndic` (for all, tout membre du cabinet) laissait n'importe quel
-- utilisateur modifier n'importe quelle colonne d'un brouillon : remettre
-- `obsolete` à faux pour émettre malgré tout, ou changer un montant à la main.
-- Les appels se créent et se recréent par app.generer_appels (SECURITY DEFINER,
-- non concernée). Un utilisateur ne change que le STATUT (émission, paiements)
-- et le report antérieur. Un droit de colonne, pas une politique : il tient même
-- si une politique était élargie un jour.
-- ---------------------------------------------------------------------

revoke insert, update, delete on appels from authenticated;
grant update (statut, report_anterieur) on appels to authenticated;

comment on column appels.obsolete is
  'Vrai quand le budget a changé depuis la génération : le brouillon ne reflète plus le budget et ne peut pas être émis. Posé par déclencheur ; effacé par la régénération.';
