-- =====================================================================
-- Moteur de répartition des charges
--
-- Règle cardinale : la clé de répartition n'est JAMAIS écrite dans le code.
-- Elle est lue dans `cles_repartition.methode` + `parametres`, et chaque
-- poste de charges pointe vers la sienne. Ajouter une clé = ajouter une
-- ligne de données, plus une branche ici seulement si la méthode est neuve.
-- =====================================================================

-- Poids de chaque lot pour une clé donnée.
-- Retourne (lot_id, poids). La somme des poids sert de dénominateur.
create or replace function app.poids_lots(p_cle_id uuid)
returns table (lot_id uuid, poids numeric)
language plpgsql stable as $$
declare
  v_methode    text;
  v_params     jsonb;
  v_immeuble   uuid;
begin
  select c.methode, c.parametres, c.immeuble_id
    into v_methode, v_params, v_immeuble
  from cles_repartition c where c.id = p_cle_id;

  if v_methode is null then
    raise exception 'Clé de répartition introuvable : %', p_cle_id;
  end if;

  if v_methode = 'tantiemes' then
    return query select l.id, l.tantiemes::numeric from lots l where l.immeuble_id = v_immeuble;

  elsif v_methode = 'parts_egales' then
    return query select l.id, 1::numeric from lots l where l.immeuble_id = v_immeuble;

  elsif v_methode = 'ponderation_etage' then
    -- tantièmes pondérés par l'étage ; les niveaux de socle peuvent être exonérés
    return query
      select l.id,
             case
               when coalesce((v_params->>'exclure_etage_zero')::boolean, true)
                    and coalesce(l.etage, 0) = 0 then 0::numeric
               else l.tantiemes::numeric
                    * (coalesce(l.etage, 0) * coalesce((v_params->>'coefficient')::numeric, 1))
             end
      from lots l where l.immeuble_id = v_immeuble;

  elsif v_methode = 'sous_ensemble' then
    -- répartition aux tantièmes, limitée aux lots listés dans les paramètres
    return query
      select l.id,
             case when l.numero = any (
                    select jsonb_array_elements_text(v_params->'lots')::integer)
                  then l.tantiemes::numeric else 0::numeric end
      from lots l where l.immeuble_id = v_immeuble;

  else
    raise exception 'Méthode de répartition inconnue : %. Ajoutez-la ici ET documentez-la dans docs/03-regles-metier.md', v_methode;
  end if;
end $$;

-- Quote-part d'un lot pour un poste de charges et un montant donnés.
create or replace function app.quote_part(p_poste_id uuid, p_montant numeric)
returns table (lot_id uuid, base_calcul numeric, montant numeric)
language plpgsql stable as $$
declare
  v_cle   uuid;
  v_total numeric;
begin
  select cle_repartition_id into v_cle from postes_charges where id = p_poste_id;
  select sum(p.poids) into v_total from app.poids_lots(v_cle) p;

  if v_total is null or v_total = 0 then
    raise exception 'La clé du poste % donne un total de poids nul : aucune répartition possible', p_poste_id;
  end if;

  return query
    select p.lot_id, p.poids, round(p_montant * p.poids / v_total, 2)
    from app.poids_lots(v_cle) p;
end $$;

-- Le propriétaire à qui adresser l'appel pour un lot, à une date donnée.
-- Si l'entité appartient à un groupe, c'est le groupe qui est facturé.
create or replace function app.destinataire_du_lot(p_lot_id uuid, p_date date default current_date)
returns uuid language sql stable as $$
  select coalesce(pr.groupe_id, pr.id)
  from lot_proprietaires lp
  join proprietaires pr on pr.id = lp.proprietaire_id
  where lp.lot_id = p_lot_id
    and lp.date_debut <= p_date
    and (lp.date_fin is null or lp.date_fin >= p_date)
  order by lp.quote_part desc
  limit 1;
$$;

-- Génération des appels d'une période : un appel par destinataire,
-- une ligne par (lot, poste). Idempotent : rejoue sans doublon.
create or replace function app.generer_appels(p_periode_id uuid)
returns integer language plpgsql security definer set search_path = public, app as $$
declare
  v_immeuble   uuid;
  v_echeance   date;
  v_periode    text;
  v_nb         integer := 0;
  r            record;
  v_appel_id   uuid;
  v_dest       uuid;
begin
  select e.immeuble_id, p.date_echeance, p.libelle
    into v_immeuble, v_echeance, v_periode
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

    insert into appels (periode_id, proprietaire_id, reference, date_echeance, statut)
    values (p_periode_id, v_dest,
            v_periode || '-' || substr(v_dest::text, 1, 8), v_echeance, 'brouillon')
    on conflict (periode_id, proprietaire_id) do nothing;

    select id into v_appel_id from appels
    where periode_id = p_periode_id and proprietaire_id = v_dest;

    insert into appel_lignes (appel_id, lot_id, poste_charge_id, base_calcul, montant)
    values (v_appel_id, r.lot_id, r.poste_charge_id, r.base_calcul, r.part);
  end loop;

  update appels a
     set montant_total = coalesce((select sum(montant) from appel_lignes l where l.appel_id = a.id), 0)
                         + a.report_anterieur
   where a.periode_id = p_periode_id;

  select count(*) into v_nb from appels where periode_id = p_periode_id;
  return v_nb;
end $$;

-- =====================================================================
-- Voix en assemblée : écrêtement éventuel du copropriétaire majoritaire
-- =====================================================================

create or replace function app.voix_assemblee(p_assemblee_id uuid)
returns table (proprietaire_id uuid, voix_brutes integer, voix_retenues integer)
language plpgsql stable as $$
declare
  v_immeuble uuid;
  v_seuil    numeric;
  v_base     integer;
begin
  select a.immeuble_id into v_immeuble from assemblees a where a.id = p_assemblee_id;
  select r.ecretement_seuil_ratio, r.base_tantiemes into v_seuil, v_base
  from reglements r where r.immeuble_id = v_immeuble and r.en_vigueur;

  return query
  with brut as (
    select coalesce(pr.groupe_id, pr.id) as pid, sum(l.tantiemes)::integer as voix
    from lots l
    join lot_proprietaires lp on lp.lot_id = l.id and lp.date_fin is null
    join proprietaires pr on pr.id = lp.proprietaire_id
    where l.immeuble_id = v_immeuble
    group by 1
  )
  select b.pid, b.voix,
         case
           when v_seuil is not null and b.voix > v_seuil * v_base
             then (select sum(o.voix)::integer from brut o where o.pid <> b.pid)
           else b.voix
         end
  from brut b;
end $$;

comment on function app.voix_assemblee is
  'Applique l''écrêtement prévu par le règlement : au-delà du seuil, les voix sont ramenées à la somme de celles des autres.';
