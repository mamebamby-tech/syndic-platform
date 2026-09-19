-- =====================================================================
-- Langue préférée de la personne (préparation au multilingue).
--
-- La langue est une préférence de la PERSONNE, pas un réglage global ni
-- un réglage du cabinet : un même cabinet sert des propriétaires répartis
-- sur cinq continents. Deux populations, deux colonnes :
--   - `membres.langue`       le personnel du cabinet (interface syndic) ;
--   - `proprietaires.langue` le copropriétaire (espace mobile, courriels,
--                            WhatsApp).
-- Une personne est une ligne `proprietaires` (CLAUDE.md règle n°4), jamais
-- une adresse électronique : la langue ne se déduit donc pas d'un contact.
--
-- Défaut : 'fr'. Le format est contraint (code ISO 639-1 sur deux lettres)
-- mais la liste des langues offertes ne l'est PAS : ajouter une langue est
-- un changement de `lib/i18n/config.ts` et de `messages/`, pas une migration.
-- Une valeur que l'application ne sait pas servir retombe sur le français.
--
-- Aucune nouvelle table, donc aucune nouvelle politique : les politiques
-- existantes de `membres` et `proprietaires` couvrent la colonne. Elles
-- portent déjà un `with check` aussi strict que leur `using` (voir
-- 20260919040000_rls_with_check_audit.sql).
--
-- Ce que cette migration ne fait PAS : laisser une personne modifier sa
-- propre langue. `membres_ecriture` réserve l'écriture au rôle
-- `proprietaire_org` ; autoriser un `update` de sa propre ligne ouvrirait
-- la porte à un changement de `role`. Le changement de langue passera par
-- une fonction dédiée qui ne touche que cette colonne — chantier différé,
-- voir docs/06-decisions.md.
-- =====================================================================

alter table membres
  add column langue text not null default 'fr'
  constraint membres_langue_format check (langue ~ '^[a-z]{2}$');

alter table proprietaires
  add column langue text not null default 'fr'
  constraint proprietaires_langue_format check (langue ~ '^[a-z]{2}$');
