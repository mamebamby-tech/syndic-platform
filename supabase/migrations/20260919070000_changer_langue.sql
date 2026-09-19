-- =====================================================================
-- Lire et changer sa propre langue.
--
-- Pourquoi une fonction et pas une politique RLS.
--
-- Écriture : `membres_ecriture` réserve l'écriture au rôle
-- `proprietaire_org`. Ouvrir un `update` sur sa propre ligne de `membres`
-- laisserait un gestionnaire y modifier `role` — une politique RLS filtre
-- des LIGNES, pas des colonnes. La fonction ci-dessous est donc le seul
-- chemin : SECURITY DEFINER, elle ne référence jamais `role`, et aucun
-- paramètre ne désigne une autre ligne que celle de l'appelant.
--
-- Lecture : un copropriétaire n'a AUCUNE politique de lecture sur
-- `proprietaires` (seul `proprietaires_syndic` existe). Lui en donner une
-- exposerait aussi `proprietaires.note`, note interne du syndic. Sans
-- cette fonction, sa langue était illisible et retombait silencieusement
-- sur le français.
--
-- Même forme que app.generer_appels : implémentation dans `app`,
-- enveloppe dans `public` (PostgREST n'expose que `public`).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Langues supportées : une donnée, pas une constante.
--
-- Ajouter une langue = une ligne ici + un fichier messages/<code>.json +
-- lib/i18n/config.ts. tests/langue.test.ts vérifie que la base et le code
-- énoncent la même liste.
--
-- Table du schéma `app`, non exposée par PostgREST, sans rattachement à un
-- cabinet : une langue n'appartient à personne. RLS active, refus explicite
-- pour tous les rôles ; seule la fonction (propriétaire de la table) la lit.
-- ---------------------------------------------------------------------

create table app.langues_supportees (
  code text primary key check (code ~ '^[a-z]{2}$')
);

alter table app.langues_supportees enable row level security;
create policy langues_supportees_fermee on app.langues_supportees
  for all using (false) with check (false);

insert into app.langues_supportees (code) values ('fr'), ('en');

-- ---------------------------------------------------------------------
-- Changer sa langue
-- ---------------------------------------------------------------------

create or replace function app.changer_langue(p_langue text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_utilisateur uuid := auth.uid();
  v_lignes      integer := 0;
  v_n           integer;
begin
  if v_utilisateur is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;

  if p_langue is null
     or not exists (select 1 from app.langues_supportees where code = p_langue) then
    raise exception 'Langue non prise en charge : %', coalesce(p_langue, 'NULL')
      using errcode = '22023';
  end if;

  -- Le personnel : ses lignes `membres` (une par cabinet). Une seule
  -- colonne écrite. `role` n'apparaît nulle part dans cette fonction.
  update public.membres set langue = p_langue where user_id = v_utilisateur;
  get diagnostics v_n = row_count;
  v_lignes := v_lignes + v_n;

  -- Le copropriétaire : la ligne `proprietaires` à laquelle son compte est
  -- rattaché. Jamais le groupe, jamais un autre membre du groupe : la
  -- préférence est celle de la personne, pas de l'ayant droit consolidé.
  update public.proprietaires set langue = p_langue
  where id in (
    select proprietaire_id from public.acces_personnes
    where user_id = v_utilisateur and proprietaire_id is not null
  );
  get diagnostics v_n = row_count;
  v_lignes := v_lignes + v_n;

  if v_lignes = 0 then
    raise exception 'Aucune préférence de langue rattachée à ce compte'
      using errcode = 'P0002';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Lire sa langue
-- ---------------------------------------------------------------------

-- Renvoie NULL si rien n'est rattaché au compte : c'est à l'application de
-- choisir sa langue par défaut. Même ordre de priorité que l'écriture
-- ci-dessus, pour que les deux ne se contredisent jamais.
create or replace function app.ma_langue()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.langue from public.membres m
      where m.user_id = auth.uid()
      order by m.cree_le limit 1),
    (select p.langue from public.acces_personnes a
      join public.proprietaires p on p.id = a.proprietaire_id
      where a.user_id = auth.uid()
      order by a.cree_le limit 1)
  );
$$;

-- ---------------------------------------------------------------------
-- Enveloppes publiques et droits
--
-- `revoke ... from public` d'abord : par défaut PostgreSQL rend toute
-- fonction exécutable par PUBLIC. Seul `authenticated` en a besoin ; le
-- rôle `anon` (aucune session) ne doit pas pouvoir les appeler.
-- ---------------------------------------------------------------------

create or replace function public.changer_langue(p_langue text)
returns void
language plpgsql
security invoker
set search_path = public, app
as $$
begin
  perform app.changer_langue(p_langue);
end $$;

create or replace function public.ma_langue()
returns text
language sql
stable
security invoker
set search_path = public, app
as $$
  select app.ma_langue();
$$;

revoke all on function app.changer_langue(text) from public;
revoke all on function app.ma_langue() from public;
revoke all on function public.changer_langue(text) from public;
revoke all on function public.ma_langue() from public;

grant execute on function app.changer_langue(text) to authenticated;
grant execute on function app.ma_langue() to authenticated;
grant execute on function public.changer_langue(text) to authenticated;
grant execute on function public.ma_langue() to authenticated;

comment on function app.changer_langue is
  'Change la langue de l''utilisateur courant, et rien d''autre : ne référence '
  'jamais `role`, ne prend aucun identifiant de ligne. Valide contre '
  'app.langues_supportees.';
comment on function app.ma_langue is
  'Langue de l''utilisateur courant (membre, sinon copropriétaire), NULL si '
  'aucune ligne. Existe car un copropriétaire ne peut pas lire `proprietaires`.';
