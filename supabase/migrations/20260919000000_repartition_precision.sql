-- =====================================================================
-- Correction de app.quote_part : précision au centime garantie.
--
-- L'ancienne version arrondissait chaque lot indépendamment
-- (round(p_montant * poids / total, 2)), ce qui peut faire dériver la
-- somme des quotes-parts de quelques centimes par rapport au montant
-- appelé — inacceptable pour de l'argent (CLAUDE.md règle n°3 : « l'argent
-- ne se devine pas », toute somme doit être traçable au centime).
--
-- Méthode du plus grand reste (Hamilton) : chaque lot reçoit d'abord la
-- part entière de centimes que lui donne son poids ; les centimes restants,
-- dus à l'arrondi, vont un par un aux lots dont la part a le plus grand
-- reste fractionnaire. La somme redistribuée est alors TOUJOURS égale au
-- montant demandé, par construction — pas seulement en moyenne.
-- =====================================================================

create or replace function app.quote_part(p_poste_id uuid, p_montant numeric)
returns table (lot_id uuid, base_calcul numeric, montant numeric)
language plpgsql stable as $$
declare
  v_cle          uuid;
  v_total_poids  numeric;
  v_montant_c    bigint;  -- montant cible, en centimes entiers
begin
  select cle_repartition_id into v_cle from postes_charges where id = p_poste_id;
  select sum(p.poids) into v_total_poids from app.poids_lots(v_cle) p;

  if v_total_poids is null or v_total_poids = 0 then
    raise exception 'La clé du poste % donne un total de poids nul : aucune répartition possible', p_poste_id;
  end if;

  v_montant_c := round(p_montant * 100);

  return query
    with parts as (
      select
        p.lot_id as v_lot_id,
        p.poids as v_base_calcul,
        floor(p_montant * p.poids / v_total_poids * 100) as v_centimes_base,
        (p_montant * p.poids / v_total_poids * 100)
          - floor(p_montant * p.poids / v_total_poids * 100) as v_reste
      from app.poids_lots(v_cle) p
    ),
    classees as (
      select
        parts.v_lot_id,
        parts.v_base_calcul,
        parts.v_centimes_base,
        row_number() over (order by parts.v_reste desc, parts.v_lot_id) as v_rang,
        v_montant_c - sum(parts.v_centimes_base) over () as v_centimes_a_repartir
      from parts
    )
    select
      classees.v_lot_id,
      classees.v_base_calcul,
      (classees.v_centimes_base
        + case when classees.v_rang <= classees.v_centimes_a_repartir then 1 else 0 end) / 100.0
    from classees
    order by classees.v_lot_id;
end $$;

comment on function app.quote_part is
  'Répartit un montant sur les lots selon le poids donné par app.poids_lots. '
  'Arrondit chaque lot au centime par la méthode du plus grand reste : la '
  'somme des montants renvoyés est toujours exactement p_montant.';
