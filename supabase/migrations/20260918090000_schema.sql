-- =====================================================================
-- Plateforme de gestion de syndic — schéma multi-tenant
-- Locataire (tenant) = une organisation (cabinet de syndic).
-- Un immeuble appartient à une organisation. Tout le reste pend d'un immeuble.
-- Aucune règle juridique n'est codée en dur : voir la table `reglements`.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. Organisations et accès du personnel
-- ---------------------------------------------------------------------

create type role_membre as enum ('proprietaire_org', 'gestionnaire', 'lecteur');

create table organisations (
  id           uuid primary key default gen_random_uuid(),
  nom          text not null,
  slug         text not null unique,
  ninea        text,
  rccm         text,
  adresse      text,
  email        text,
  telephone    text,
  logo_path    text,
  cree_le      timestamptz not null default now()
);

create table membres (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  role              role_membre not null default 'gestionnaire',
  cree_le           timestamptz not null default now(),
  unique (organisation_id, user_id)
);
create index on membres (user_id);

-- ---------------------------------------------------------------------
-- 2. Immeubles et leur règlement de copropriété
-- ---------------------------------------------------------------------

create table immeubles (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id) on delete cascade,
  nom               text not null,
  adresse           text,
  ville             text,
  pays              text not null default 'SN',
  titre_foncier     text,
  devise            text not null default 'XOF',
  cree_le           timestamptz not null default now()
);
create index on immeubles (organisation_id);

create type periodicite as enum ('mensuel', 'trimestriel', 'semestriel', 'annuel');

-- Le règlement de copropriété, transcrit en paramètres.
-- Une ligne par immeuble (versionnable : `en_vigueur` + dates).
create table reglements (
  id                            uuid primary key default gen_random_uuid(),
  immeuble_id                   uuid not null references immeubles(id) on delete cascade,
  libelle                       text not null,
  date_depot                    date,
  notaire                       text,
  document_path                 text,
  en_vigueur                    boolean not null default true,

  -- Assiette de répartition
  base_tantiemes                integer not null default 10000,   -- 1000 = millièmes, 10000 = dix-millièmes

  -- Appels de fonds
  periodicite_appel             periodicite not null default 'trimestriel',
  jour_exigibilite              smallint not null default 1,      -- 1 = premier jour de la période
  delai_paiement_jours          smallint not null default 30,

  -- Pénalités de retard
  taux_penalite                 numeric(6,4) not null default 0,  -- ex. 0.10 = 10 %
  penalite_par                  periodicite not null default 'mensuel',
  penalite_requiert_mise_en_demeure boolean not null default true,
  penalite_automatique          boolean not null default false,   -- false = le syndic décide de l'appliquer

  -- Assemblées générales
  delai_convocation_jours           smallint not null default 10,
  delai_convocation_renforce_jours  smallint not null default 20,
  quorum_tantiemes_ratio            numeric(5,4),                 -- ex. 0.5000 (strictement supérieur)
  seconde_convocation_sans_quorum   boolean not null default true,
  ecretement_seuil_ratio            numeric(5,4),                 -- ex. 0.5000, null = pas d'écrêtement
  demande_convocation_ratio         numeric(5,4),                 -- part des tantièmes pouvant exiger une AG
  carence_syndic_jours              smallint,

  -- Conseil syndical et pouvoirs du syndic
  conseil_syndical_membres      smallint,
  conseil_syndical_exercices    smallint,
  plafond_pouvoirs_mandataire   integer,                          -- null = non plafonné
  plafond_depense_syndic        numeric(14,2),

  cree_le                       timestamptz not null default now()
);
create unique index on reglements (immeuble_id) where en_vigueur;

-- Les cas qui déclenchent le délai de convocation renforcé.
create table motifs_delai_renforce (
  id             uuid primary key default gen_random_uuid(),
  reglement_id   uuid not null references reglements(id) on delete cascade,
  code           text not null,
  libelle        text not null,
  unique (reglement_id, code)
);

-- Les types de majorité, tels que le règlement les définit.
-- Une majorité peut cumuler plusieurs conditions : toutes doivent être remplies.
create table types_majorite (
  id                              uuid primary key default gen_random_uuid(),
  reglement_id                    uuid not null references reglements(id) on delete cascade,
  code                            text not null,
  libelle                         text not null,
  article                         text,
  exige_unanimite                 boolean not null default false,
  ratio_nombre_syndicat           numeric(5,4),  -- part des copropriétaires EN NOMBRE
  ratio_voix_presents             numeric(5,4),  -- part des voix des présents ou représentés
  ratio_voix_syndicat             numeric(5,4),  -- part des voix de l'ensemble du syndicat
  exige_accord_charges_augmentees boolean not null default false,
  declenche_delai_renforce        boolean not null default false,
  unique (reglement_id, code)
);

-- ---------------------------------------------------------------------
-- 3. Lots, propriétaires, occupants
-- ---------------------------------------------------------------------

create type type_personne as enum ('physique', 'morale');
create type nature_detention as enum ('pleine_propriete', 'nue_propriete', 'usufruit', 'indivision');

create table proprietaires (
  id             uuid primary key default gen_random_uuid(),
  immeuble_id    uuid not null references immeubles(id) on delete cascade,
  nom            text not null,
  type           type_personne not null default 'physique',
  email          text,
  telephone      text,
  pays           text,
  -- Regroupement d'entités distinctes appartenant au même ayant droit.
  -- Le regroupement est une DONNÉE, réversible, jamais une déduction du code.
  groupe_id      uuid references proprietaires(id) on delete set null,
  est_groupe     boolean not null default false,
  note           text,
  cree_le        timestamptz not null default now()
);
create index on proprietaires (immeuble_id);
create index on proprietaires (groupe_id);

create table lots (
  id             uuid primary key default gen_random_uuid(),
  immeuble_id    uuid not null references immeubles(id) on delete cascade,
  numero         integer not null,
  designation    text not null,
  niveau         text,
  etage          smallint,
  superficie_m2  numeric(10,2),
  tantiemes      integer not null,
  cree_le        timestamptz not null default now(),
  unique (immeuble_id, numero)
);
create index on lots (immeuble_id);

-- Un lot peut avoir plusieurs détenteurs (indivision, démembrement) et changer de mains.
create table lot_proprietaires (
  id               uuid primary key default gen_random_uuid(),
  lot_id           uuid not null references lots(id) on delete cascade,
  proprietaire_id  uuid not null references proprietaires(id) on delete cascade,
  nature           nature_detention not null default 'pleine_propriete',
  quote_part       numeric(6,4) not null default 1,
  date_debut       date not null default current_date,
  date_fin         date,
  check (quote_part > 0 and quote_part <= 1)
);
create index on lot_proprietaires (lot_id);
create index on lot_proprietaires (proprietaire_id);

create table occupants (
  id           uuid primary key default gen_random_uuid(),
  lot_id       uuid not null references lots(id) on delete cascade,
  nom          text not null,
  email        text,
  telephone    text,
  est_locataire boolean not null default true,
  date_debut   date,
  date_fin     date
);

-- Rattachement d'un compte d'authentification à un propriétaire ou un occupant.
create table acces_personnes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  proprietaire_id  uuid references proprietaires(id) on delete cascade,
  occupant_id      uuid references occupants(id) on delete cascade,
  cree_le          timestamptz not null default now(),
  check (num_nonnulls(proprietaire_id, occupant_id) = 1)
);
create index on acces_personnes (user_id);

-- ---------------------------------------------------------------------
-- 4. Budget : clés de répartition et postes de charges
-- ---------------------------------------------------------------------

-- methode : 'tantiemes' | 'parts_egales' | 'ponderation_etage' | 'sous_ensemble'
-- parametres (jsonb) porte ce dont la méthode a besoin, jamais le code :
--   ponderation_etage : {"exclure_etage_zero": true, "coefficient": 1}
--   sous_ensemble     : {"lots": [12, 13, 14]}
create table cles_repartition (
  id            uuid primary key default gen_random_uuid(),
  immeuble_id   uuid not null references immeubles(id) on delete cascade,
  code          text not null,
  libelle       text not null,
  methode       text not null,
  parametres    jsonb not null default '{}'::jsonb,
  article       text,
  unique (immeuble_id, code)
);

create table postes_charges (
  id                  uuid primary key default gen_random_uuid(),
  immeuble_id         uuid not null references immeubles(id) on delete cascade,
  libelle             text not null,
  categorie           text not null default 'general',
  cle_repartition_id  uuid not null references cles_repartition(id),
  actif               boolean not null default true,
  ordre               smallint not null default 0
);
create index on postes_charges (immeuble_id);

-- ---------------------------------------------------------------------
-- 5. Exercices, périodes, appels de fonds
-- ---------------------------------------------------------------------

create type statut_periode as enum ('brouillon', 'vote', 'appele', 'clos');
create type statut_appel   as enum ('brouillon', 'emis', 'partiel', 'solde', 'annule');

create table exercices (
  id            uuid primary key default gen_random_uuid(),
  immeuble_id   uuid not null references immeubles(id) on delete cascade,
  libelle       text not null,
  date_debut    date not null,
  date_fin      date not null,
  budget_vote   numeric(14,2),
  vote_le       date
);

create table periodes (
  id            uuid primary key default gen_random_uuid(),
  exercice_id   uuid not null references exercices(id) on delete cascade,
  libelle       text not null,
  date_debut    date not null,
  date_fin      date not null,
  date_echeance date not null,
  statut        statut_periode not null default 'brouillon'
);

create table budget_lignes (
  id                uuid primary key default gen_random_uuid(),
  periode_id        uuid not null references periodes(id) on delete cascade,
  poste_charge_id   uuid not null references postes_charges(id),
  montant           numeric(14,2) not null default 0,
  fournisseur       text,
  note              text,
  unique (periode_id, poste_charge_id)
);

-- Un appel est adressé à un PROPRIÉTAIRE, pas à un lot :
-- un propriétaire multi-lots reçoit un seul document et règle une seule fois.
create table appels (
  id               uuid primary key default gen_random_uuid(),
  periode_id       uuid not null references periodes(id) on delete cascade,
  proprietaire_id  uuid not null references proprietaires(id) on delete cascade,
  reference        text not null,
  montant_total    numeric(14,2) not null default 0,
  report_anterieur numeric(14,2) not null default 0,
  date_emission    date,
  date_echeance    date not null,
  statut           statut_appel not null default 'brouillon',
  document_path    text,
  cree_le          timestamptz not null default now(),
  unique (periode_id, proprietaire_id)
);
create index on appels (proprietaire_id);

create table appel_lignes (
  id                uuid primary key default gen_random_uuid(),
  appel_id          uuid not null references appels(id) on delete cascade,
  lot_id            uuid not null references lots(id),
  poste_charge_id   uuid not null references postes_charges(id),
  base_calcul       numeric(14,4) not null,  -- poids du lot dans la clé retenue
  montant           numeric(14,2) not null
);
create index on appel_lignes (appel_id);

-- ---------------------------------------------------------------------
-- 6. Paiements, mises en demeure, pénalités
-- ---------------------------------------------------------------------

create type moyen_paiement as enum ('wave', 'orange_money', 'virement', 'virement_international', 'especes', 'cheque');
create type statut_paiement as enum ('en_attente', 'confirme', 'echoue', 'rembourse');
create type statut_penalite as enum ('calculee', 'appliquee', 'renoncee');

create table paiements (
  id                uuid primary key default gen_random_uuid(),
  appel_id          uuid references appels(id) on delete set null,
  proprietaire_id   uuid not null references proprietaires(id) on delete cascade,
  montant           numeric(14,2) not null,
  moyen             moyen_paiement not null,
  reference_externe text,
  date_paiement     timestamptz not null default now(),
  statut            statut_paiement not null default 'en_attente',
  recu_path         text,
  saisi_par         uuid references auth.users(id),
  cree_le           timestamptz not null default now()
);
create index on paiements (appel_id);
create index on paiements (proprietaire_id);

create table mises_en_demeure (
  id               uuid primary key default gen_random_uuid(),
  appel_id         uuid not null references appels(id) on delete cascade,
  envoyee_le       date not null,
  canal            text,
  document_path    text
);

-- La pénalité est TOUJOURS calculée, jamais appliquée en silence :
-- le syndic l'applique ou y renonce explicitement.
create table penalites (
  id               uuid primary key default gen_random_uuid(),
  appel_id         uuid not null references appels(id) on delete cascade,
  base_calcul      numeric(14,2) not null,
  taux_applique    numeric(6,4) not null,
  periodes_retard  integer not null,
  montant          numeric(14,2) not null,
  statut           statut_penalite not null default 'calculee',
  decide_par       uuid references auth.users(id),
  decide_le        timestamptz,
  motif            text
);

-- ---------------------------------------------------------------------
-- 7. Assemblées générales
-- ---------------------------------------------------------------------

create type type_assemblee as enum ('ordinaire', 'extraordinaire');
create type statut_assemblee as enum ('brouillon', 'convoquee', 'tenue', 'annulee');
create type statut_presence as enum ('present', 'represente', 'absent');
create type sens_vote as enum ('pour', 'contre', 'abstention');

create table assemblees (
  id                     uuid primary key default gen_random_uuid(),
  immeuble_id            uuid not null references immeubles(id) on delete cascade,
  type                   type_assemblee not null default 'ordinaire',
  date_seance            timestamptz not null,
  lieu                   text,
  statut                 statut_assemblee not null default 'brouillon',
  convoquee_le           date,
  delai_applique_jours   smallint,
  proces_verbal_path     text
);

create table resolutions (
  id                 uuid primary key default gen_random_uuid(),
  assemblee_id       uuid not null references assemblees(id) on delete cascade,
  ordre              smallint not null,
  titre              text not null,
  description        text,
  type_majorite_id   uuid not null references types_majorite(id),
  adoptee            boolean,
  unique (assemblee_id, ordre)
);

create table convocations (
  id                uuid primary key default gen_random_uuid(),
  assemblee_id      uuid not null references assemblees(id) on delete cascade,
  proprietaire_id   uuid not null references proprietaires(id) on delete cascade,
  canal             text not null,
  envoyee_le        timestamptz,
  accusee_le        timestamptz,
  unique (assemblee_id, proprietaire_id, canal)
);

create table presences (
  id                 uuid primary key default gen_random_uuid(),
  assemblee_id       uuid not null references assemblees(id) on delete cascade,
  proprietaire_id    uuid not null references proprietaires(id) on delete cascade,
  statut             statut_presence not null default 'absent',
  mandataire_id      uuid references proprietaires(id) on delete set null,
  mandataire_externe text,
  voix_brutes        integer not null default 0,
  voix_retenues      integer not null default 0,  -- après écrêtement éventuel
  unique (assemblee_id, proprietaire_id)
);

create table votes (
  id               uuid primary key default gen_random_uuid(),
  resolution_id    uuid not null references resolutions(id) on delete cascade,
  proprietaire_id  uuid not null references proprietaires(id) on delete cascade,
  sens             sens_vote not null,
  voix             integer not null,
  unique (resolution_id, proprietaire_id)
);

-- ---------------------------------------------------------------------
-- 8. Documents, annonces, incidents, notifications
-- ---------------------------------------------------------------------

create type visibilite as enum ('syndic', 'proprietaires', 'tous');
create type statut_incident as enum ('ouvert', 'en_cours', 'resolu', 'refuse');

create table documents (
  id            uuid primary key default gen_random_uuid(),
  immeuble_id   uuid not null references immeubles(id) on delete cascade,
  categorie     text not null,
  titre         text not null,
  storage_path  text not null,
  visibilite    visibilite not null default 'proprietaires',
  depose_le     timestamptz not null default now(),
  depose_par    uuid references auth.users(id)
);

create table annonces (
  id            uuid primary key default gen_random_uuid(),
  immeuble_id   uuid not null references immeubles(id) on delete cascade,
  titre         text not null,
  corps         text not null,
  publiee_le    timestamptz not null default now(),
  publiee_par   uuid references auth.users(id)
);

create table incidents (
  id            uuid primary key default gen_random_uuid(),
  immeuble_id   uuid not null references immeubles(id) on delete cascade,
  lot_id        uuid references lots(id) on delete set null,
  declarant_id  uuid references auth.users(id),
  titre         text not null,
  description   text,
  photo_path    text,
  statut        statut_incident not null default 'ouvert',
  cree_le       timestamptz not null default now(),
  resolu_le     timestamptz
);

create table notifications (
  id               uuid primary key default gen_random_uuid(),
  immeuble_id      uuid not null references immeubles(id) on delete cascade,
  proprietaire_id  uuid references proprietaires(id) on delete cascade,
  canal            text not null,          -- 'email' | 'whatsapp' | 'sms'
  gabarit          text not null,
  charge_utile     jsonb not null default '{}'::jsonb,
  statut           text not null default 'en_attente',
  envoyee_le       timestamptz,
  erreur           text,
  cree_le          timestamptz not null default now()
);
create index on notifications (statut, cree_le);

-- ---------------------------------------------------------------------
-- 9. Journal d'audit — qui a changé quoi (utile en cas de litige)
-- ---------------------------------------------------------------------

create table journal (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  acteur_id        uuid references auth.users(id),
  entite           text not null,
  entite_id        uuid,
  action           text not null,
  avant            jsonb,
  apres            jsonb,
  cree_le          timestamptz not null default now()
);
create index on journal (organisation_id, cree_le desc);
