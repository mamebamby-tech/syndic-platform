-- =====================================================================
-- La note interne d'un propriétaire n'est lisible que par le gestionnaire et
-- le proprietaire_org.
--
-- `proprietaires.note` est une note INTERNE du syndic sur un propriétaire.
-- Tout le personnel du cabinet, lecteurs compris, lisait la ligne entière donc
-- la note : la sécurité par ligne filtre des lignes, pas des colonnes, et un
-- droit de colonne ne distingue pas gestionnaire et lecteur (même rôle SQL).
--
-- La note passe donc dans sa propre table, avec sa propre politique de LECTURE,
-- réservée aux habilités (app.est_gestionnaire, via app.immeubles_habilites). Les
-- notes existantes sont copiées, puis la colonne est supprimée : il ne reste
-- aucun endroit où un lecteur puisse la lire.
--
-- Une note par propriétaire. `immeuble_id` est dupliqué (règle n°2 : toute table
-- pend d'un immeuble) ; une clé étrangère COMPOSITE garantit qu'il est toujours
-- celui du propriétaire — une note ne peut pas viser un autre immeuble que le sien.
--
-- Aucun code de l'application ne lisait cette colonne : seuls le seed et le
-- chargeur du registre l'écrivaient.
-- =====================================================================

-- Cible de la clé étrangère composite.
alter table proprietaires add constraint proprietaires_id_immeuble_unique unique (id, immeuble_id);

create table proprietaires_notes (
  proprietaire_id  uuid primary key,
  immeuble_id      uuid not null references immeubles(id) on delete cascade,
  note             text not null check (btrim(note) <> ''),
  foreign key (proprietaire_id, immeuble_id)
    references proprietaires (id, immeuble_id) on delete cascade
);
create index on proprietaires_notes (immeuble_id);

-- Les notes existantes, sans rien perdre (les notes vides n'en sont pas).
insert into proprietaires_notes (proprietaire_id, immeuble_id, note)
select id, immeuble_id, btrim(note)
from proprietaires
where note is not null and btrim(note) <> '';

-- Lecture ET écriture réservées aux habilités : le lecteur ne voit pas la table.
alter table proprietaires_notes enable row level security;
alter table proprietaires_notes force row level security;

create policy proprietaires_notes_lecture_habilites on proprietaires_notes for select
  using (immeuble_id in (select app.immeubles_habilites()));
create policy proprietaires_notes_insertion_habilites on proprietaires_notes for insert
  with check (immeuble_id in (select app.immeubles_habilites()));
create policy proprietaires_notes_modification_habilites on proprietaires_notes for update
  using (immeuble_id in (select app.immeubles_habilites()))
  with check (immeuble_id in (select app.immeubles_habilites()));
create policy proprietaires_notes_suppression_habilites on proprietaires_notes for delete
  using (immeuble_id in (select app.immeubles_habilites()));

alter table proprietaires drop column note;

comment on table proprietaires_notes is
  'Note interne du syndic sur un propriétaire. Lisible et modifiable par le gestionnaire et le proprietaire_org uniquement ; jamais par un lecteur, un copropriétaire ou un autre cabinet.';
