-- =====================================================================
-- Le PDF de l'appel de fonds, et la trace de son envoi (décisions 68 à 70).
--
--   1. Le contact gestionnaire de l'immeuble (nom, courriel), imprimé sur
--      l'appel. Donnée de l'immeuble, figée dans l'instantané à l'émission.
--   2. L'article du règlement qui prévoit les conséquences d'un retard : le
--      rappel imprimé sur l'appel se compose des paramètres du règlement,
--      jamais d'un texte en dur (CLAUDE.md, règle n°1).
--   3. L'instantané, version 2 : tout ce que le PDF imprime — lots du
--      destinataire, clé et base totale de chaque poste, gestionnaire,
--      conséquences du retard. La version 1 reste lisible (écran) ; le PDF
--      exige la version 2.
--   4. `documents_appels` : le PDF engendré, UN par appel, jamais remplacé.
--      Stocké dans le seau privé `appels` ; toute consultation et tout renvoi
--      servent ce fichier-là.
--   5. public.tracer_envoi_appel : chaque tentative d'envoi laisse une ligne
--      dans `journal` — qui, quand, vers quelle adresse, quelle référence, et
--      ce qu'a répondu le service d'envoi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Contact gestionnaire
-- ---------------------------------------------------------------------

alter table immeubles
  add column gestionnaire_nom text,
  add column gestionnaire_email text,
  add constraint immeubles_gestionnaire_email_forme
    check (gestionnaire_email is null or gestionnaire_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

comment on column immeubles.gestionnaire_nom is
  'Interlocuteur des copropriétaires pour cet immeuble, imprimé sur les appels de fonds (figé dans l''instantané).';

-- Modifiables depuis l'écran Paramètres (droit de colonne, voir 20260919140000).
grant update (gestionnaire_nom, gestionnaire_email) on immeubles to authenticated;

-- ---------------------------------------------------------------------
-- 2. Où le règlement prévoit les conséquences d'un retard
-- ---------------------------------------------------------------------

alter table reglements add column article_retard text;

comment on column reglements.article_retard is
  'Article du règlement qui fixe les intérêts de retard (« art. 17 »). Cité par le rappel imprimé sur les appels.';

-- ---------------------------------------------------------------------
-- 3. Instantané, version 2
-- ---------------------------------------------------------------------

create or replace function app.instantane_appel(a appels)
returns jsonb language sql volatile security definer set search_path = public, app as $$
  with postes as (
    -- Pour chaque poste de l'appel : sa clé, le montant du poste au budget de la
    -- période, et la base totale de la clé (somme des poids de tous les lots).
    select bl.poste_charge_id,
           bl.montant as montant_poste,
           c.libelle as cle_libelle,
           (select sum(q.base_calcul) from app.quote_part(bl.poste_charge_id, bl.montant) q) as base_totale
    from budget_lignes bl
    join postes_charges pc on pc.id = bl.poste_charge_id
    join cles_repartition c on c.id = pc.cle_repartition_id
    where bl.periode_id = a.periode_id
      and bl.poste_charge_id in (select poste_charge_id from appel_lignes where appel_id = a.id)
  )
  select jsonb_build_object(
    'version', 2,
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
      'compte_modifie_le', i.compte_modifie_le),
    -- Les conséquences d'un retard, telles que le règlement EN VIGUEUR les prévoit.
    'retard', (
      select jsonb_build_object(
               'taux_penalite', r.taux_penalite,
               'penalite_par', r.penalite_par,
               'requiert_mise_en_demeure', r.penalite_requiert_mise_en_demeure,
               'delai_paiement_jours', r.delai_paiement_jours,
               'article', r.article_retard)
      from reglements r where r.immeuble_id = i.id and r.en_vigueur)
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
-- 4. Le PDF engendré : un par appel, jamais remplacé
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('appels', 'appels', false)
on conflict (id) do nothing;

create table documents_appels (
  appel_id     uuid primary key references appels(id) on delete cascade,
  immeuble_id  uuid not null references immeubles(id) on delete cascade,
  -- Chemin dans le seau `appels` : <immeuble_id>/<appel_id>.pdf
  chemin       text not null unique,
  -- SHA-256 du fichier, en hexadécimal : ce qui a été envoyé se vérifie.
  empreinte    text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  taille       integer not null check (taille > 0),
  engendre_le  timestamptz not null default now(),
  engendre_par uuid references auth.users(id) on delete set null
);

comment on table documents_appels is
  'Le PDF d''un appel émis, engendré une seule fois depuis l''instantané. Ni modifié ni remplacé : consultation et renvoi servent ce fichier-là.';

alter table documents_appels enable row level security;
alter table documents_appels force row level security;

-- Lecture : le personnel du cabinet. Aucune écriture directe : la seule voie
-- est public.enregistrer_document_appel (droit de table retiré).
create policy documents_appels_lecture_personnel on documents_appels for select
  using (immeuble_id in (select app.immeubles_de_lutilisateur()));
revoke insert, update, delete on documents_appels from authenticated, anon;

create or replace function public.enregistrer_document_appel(
  p_appel uuid, p_chemin text, p_empreinte text, p_taille integer)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  v_immeuble uuid;
  v_statut   statut_appel;
begin
  select e.immeuble_id, a.statut into v_immeuble, v_statut
  from appels a join periodes per on per.id = a.periode_id join exercices e on e.id = per.exercice_id
  where a.id = p_appel;

  if auth.uid() is not null and not app.est_gestionnaire(v_immeuble) then
    raise exception 'Appel introuvable, ou réservé au gestionnaire et au proprietaire_org' using errcode = '42501';
  end if;
  if v_immeuble is null then
    raise exception 'Appel introuvable' using errcode = '23503';
  end if;
  if v_statut not in ('emis', 'partiel', 'solde') then
    raise exception 'Le PDF ne s''engendre que pour un appel émis' using errcode = '23514';
  end if;
  if p_chemin is distinct from v_immeuble::text || '/' || p_appel::text || '.pdf' then
    raise exception 'Chemin de document inattendu' using errcode = '22023';
  end if;
  if exists (select 1 from documents_appels where appel_id = p_appel) then
    raise exception 'Le PDF de cet appel existe déjà : il n''est jamais remplacé' using errcode = '23505';
  end if;

  insert into documents_appels (appel_id, immeuble_id, chemin, empreinte, taille, engendre_par)
  values (p_appel, v_immeuble, p_chemin, p_empreinte, p_taille, auth.uid());
end $$;

revoke all on function public.enregistrer_document_appel(uuid, text, text, integer) from public, anon;
grant execute on function public.enregistrer_document_appel(uuid, text, text, integer) to authenticated;

-- Conversion tolérante : dans une politique, l'ordre d'évaluation des conditions
-- n'est pas garanti ; un chemin d'un autre seau ne doit jamais lever d'erreur.
create or replace function app.uuid_ou_nul(p_texte text)
returns uuid language plpgsql immutable set search_path = public as $$
begin
  return p_texte::uuid;
exception when others then
  return null;
end $$;
grant execute on function app.uuid_ou_nul(text) to authenticated;

-- Le seau : chemin <immeuble_id>/<appel_id>.pdf. Lecture par le personnel du
-- cabinet ; dépôt par un habilité ; ni remplacement ni suppression.
create policy appels_pdf_lecture on storage.objects for select to authenticated
  using (bucket_id = 'appels'
         and app.uuid_ou_nul((storage.foldername(name))[1]) in (select app.immeubles_de_lutilisateur()));
create policy appels_pdf_depot on storage.objects for insert to authenticated
  with check (bucket_id = 'appels'
              and app.est_gestionnaire(app.uuid_ou_nul((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------
-- 5. La trace de chaque envoi
-- ---------------------------------------------------------------------

create or replace function public.tracer_envoi_appel(
  p_appel uuid,
  p_canal text,
  p_adresse text,
  p_adresse_prevue text,
  p_reussi boolean,
  p_resultat jsonb)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_immeuble     uuid;
  v_organisation uuid;
  v_reference    text;
  v_id           uuid;
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

  insert into journal (organisation_id, acteur_id, acteur_libelle, entite, entite_id, action, avant, apres, cree_le)
  values (v_organisation, auth.uid(), app.libelle_acteur(), 'appels', p_appel,
          case when p_reussi then 'appel_envoye' else 'appel_envoi_echoue' end,
          null,
          jsonb_build_object(
            'reference', v_reference,
            'canal', p_canal,
            'adresse', p_adresse,
            -- Démonstration : l'adresse du destinataire fictif, remplacée par la redirection.
            'adresse_prevue', p_adresse_prevue,
            'redirige', p_adresse_prevue is not null and p_adresse_prevue is distinct from p_adresse,
            'resultat', coalesce(p_resultat, '{}'::jsonb)),
          clock_timestamp())
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.tracer_envoi_appel(uuid, text, text, text, boolean, jsonb) from public, anon;
grant execute on function public.tracer_envoi_appel(uuid, text, text, text, boolean, jsonb) to authenticated;
