-- =====================================================================
-- Jeu de données de démonstration — Mamelles Tower
--
-- LES PERSONNES SONT FICTIVES. La structure, elle, est exacte : mêmes
-- 62 lots, mêmes 10 000 tantièmes, même répartition entre détenteurs,
-- et les mêmes quatre anomalies de contact que le registre réel, pour
-- que les contrôles de qualité des données restent testables.
--
-- Les adresses utilisent les domaines example.com / .org / .net,
-- réservés par la RFC 2606 : aucun message ne peut partir vers un vrai
-- destinataire par accident.
--
-- Le registre réel n'est pas versionné. Il vit dans donnees-privees/,
-- ignoré par Git, et se charge séparément. Voir docs/06-decisions.md.
--
-- Paramètres juridiques : ceux du règlement de copropriété réel, qui
-- n'est pas une donnée personnelle.
-- =====================================================================

begin;

insert into organisations (nom, slug, ninea, rccm, adresse, email)
values ('ENIGMA AFRICA SARL', 'enigma-africa', '010008391 2R2', 'SN.DKR.2023.B.2743',
        'Cité Keur Damel, Villa N°17, Dakar', 'enigma@enigmasn.com');

-- code_reference : préfixe des références d'appel (MT-2026T4-007).
-- Les coordonnées bancaires du syndicat (compte_*) sont posées plus bas, fictives :
-- l'émission des appels est bloquée tant qu'elles sont vides.
insert into immeubles (organisation_id, nom, adresse, ville, pays, titre_foncier, code_reference)
select id, 'Mamelles Tower', 'Corniche des Mamelles, Ngor-Almadies', 'Dakar', 'SN', 'TF n°26821/NGA', 'MT'
from organisations where slug = 'enigma-africa';

-- ---------------------------------------------------------------------
-- Le règlement de copropriété, transcrit en paramètres
-- ---------------------------------------------------------------------
insert into reglements (
  immeuble_id, libelle, date_depot, notaire, en_vigueur, base_tantiemes,
  periodicite_appel, jour_exigibilite, delai_paiement_jours,
  taux_penalite, penalite_par, penalite_requiert_mise_en_demeure, penalite_automatique,
  delai_convocation_jours, delai_convocation_renforce_jours,
  quorum_tantiemes_ratio, seconde_convocation_sans_quorum, ecretement_seuil_ratio,
  demande_convocation_ratio, carence_syndic_jours,
  conseil_syndical_membres, conseil_syndical_exercices,
  plafond_pouvoirs_mandataire, plafond_depense_syndic)
select i.id,
  'Règlement de copropriété SCI Mamelles Tower', date '2025-09-01',
  'Me Tabara Mathurin DIOP, notaire associée, Charge de Dakar XX', true,
  10000,              -- art. 7 : état descriptif de division
  'trimestriel',      -- art. 17 : recouvrement trimestriel par compte à échoir
  1,                  -- art. 16 : premier jour de chaque trimestre
  30,                 -- art. 16 : règlement dans le mois de l'envoi de l'arrêté
  0.10, 'mensuel',    -- art. 17 : 10 % par mois de retard
  true,               -- art. 17 : après mise en demeure restée infructueuse
  false,              -- décision explicite du syndic, jamais un automatisme
  10, 20,             -- art. 30-1 et 30-2
  0.5000, true,       -- art. 33-2 d° : quorum, puis seconde convocation libre
  0.5000,             -- art. 33-1 : écrêtement du copropriétaire majoritaire
  0.3333, 15,         -- art. 29 : tiers des millièmes, carence de 15 jours
  3, 3,               -- art. 28 : trois copropriétaires, trois exercices
  null,               -- art. 31 : aucun plafond de pouvoirs par mandataire
  null                -- art. 26-2 a) : plafond de dépense à fixer par l'assemblée
from immeubles i where i.nom = 'Mamelles Tower';

insert into motifs_delai_renforce (reglement_id, code, libelle)
select r.id, m.code, m.libelle
from reglements r, (values
  ('repartition_tantiemes',  'Modification de la répartition des tantièmes (art. 30-2 a°)'),
  ('classification_parties', 'Modification de la classification parties communes / privées (art. 30-2 a°)'),
  ('repartition_charges',    'Modification de la répartition des charges communes (art. 30-2 b°)'),
  ('modification_rcp',       'Modification, suppression ou adjonction au règlement (art. 30-2 c°)'),
  ('destruction_immeuble',   'Décisions consécutives à la destruction de l''immeuble (art. 30-2 d°)')
) as m(code, libelle) where r.en_vigueur;

insert into types_majorite (
  reglement_id, code, libelle, article, exige_unanimite,
  ratio_nombre_syndicat, ratio_voix_presents, ratio_voix_syndicat,
  exige_accord_charges_augmentees, declenche_delai_renforce)
select r.id, t.code, t.libelle, t.article, t.unanim, t.rn, t.rvp, t.rvs, t.accord, t.renforce
from reglements r, (values
  ('unanimite', 'Unanimité des copropriétaires du syndicat', 'art. 33-2 a°',
   true,  null::numeric, null::numeric, null::numeric, false, true),
  ('absolue', 'Majorité absolue — double majorité', 'art. 33-2 b°',
   false, 0.5000, 0.7500, null, true, true),
  ('simple_syndicat', 'Majorité simple des voix du syndicat', 'art. 33-2 c°',
   false, null, null, 0.5000, false, false),
  ('ordinaire', 'Majorité des voix des présents ou représentés', 'art. 33-2 d°',
   false, null, 0.5000, null, false, false)
) as t(code, libelle, article, unanim, rn, rvp, rvs, accord, renforce)
where r.en_vigueur;

-- ---------------------------------------------------------------------
-- Clés de répartition
-- ---------------------------------------------------------------------
insert into cles_repartition (immeuble_id, code, libelle, methode, parametres, article)
select i.id, c.code, c.libelle, c.methode, c.params::jsonb, c.article
from immeubles i, (values
  ('tantiemes', 'Tantièmes de l''état descriptif', 'tantiemes', '{}',
   'art. 15 : proportionnellement à la part dans les choses communes'),
  ('ponderation_etage', 'Tantièmes pondérés par l''étage', 'ponderation_etage',
   '{"exclure_etage_zero": true, "coefficient": 1}',
   'Proposition du rapport de gestion du 17/09/2026 — contraire à l''art. 15 en l''état'),
  ('parts_egales', 'Parts égales entre lots', 'parts_egales', '{}', null)
) as c(code, libelle, methode, params, article)
where i.nom = 'Mamelles Tower';

-- ---------------------------------------------------------------------
-- Postes de charges (les montants sont saisis par période, pas ici)
-- ---------------------------------------------------------------------
insert into postes_charges (immeuble_id, libelle, categorie, cle_repartition_id, ordre)
select i.id, p.libelle, p.cat, c.id, p.ordre
from immeubles i
join cles_repartition c on c.immeuble_id = i.id and c.code = 'tantiemes',
(values
  ('Électricité des parties communes', 'general', 1),
  ('Eau des parties communes', 'general', 2),
  ('Gardiennage et sécurité', 'general', 3),
  ('Nettoyage et entretien général', 'general', 4),
  ('Entretien des espaces verts', 'general', 5),
  ('Assurance de l''immeuble', 'general', 6),
  ('Maintenance du groupe électrogène', 'general', 7),
  ('Honoraires du syndic', 'general', 8),
  ('Divers et imprévus', 'general', 9),
  ('Maintenance des ascenseurs', 'ascenseur', 10),
  ('Électricité des ascenseurs', 'ascenseur', 11)
) as p(libelle, cat, ordre)
where i.nom = 'Mamelles Tower';


-- ---------------------------------------------------------------------
-- Copropriétaires (fictifs)
-- Le groupe SCI ALIZE réunit trois entités partageant le même contact.
-- Hypothèse réversible : vider leur groupe_id ramène à 21 comptes.
-- ---------------------------------------------------------------------
insert into proprietaires (immeuble_id, nom, type, email, telephone, pays, est_groupe)
select i.id, 'SCI ALIZE (groupe)', 'morale', 'sci.alize@example.com', '+221700000001', 'SN', true
from immeubles i where i.nom = 'Mamelles Tower';

-- La note interne d'un propriétaire vit dans proprietaires_notes (lisible par les
-- seuls habilités) : une seule instruction insère les propriétaires puis leurs notes.
with v(nom, typ, mail, tel, pays, note) as (values
  ('SCI ALIZE', 'morale', 'sci.alize@example.com', '+221700000001', 'SN', null),
  ('Awa TOURE', 'physique', 'awa.toure@example.com', '+221700000004', 'SN', null),
  ('NDIAYE HOLDING', 'morale', 'ndiaye.holding@example.com', '+221700000002', 'SN', null),
  ('HORIZON IMPORT EXPORT', 'morale', 'horizon.ie@example.com', '+221700000003', 'SN', null),
  ('Moussa BA', 'physique', 'contact.partage@example.com', '+221700000008', 'SN', null),
  ('SCI ALIZE (BRANCHE B)', 'morale', 'sci.alize@example.com', '+221700000001', 'SN', null),
  ('Kemal ARSLAN', 'physique', 'kemal.arslan@example.com', null, 'TR', 'Aucun numéro de téléphone au registre'),
  ('Emre YILMAZ', 'physique', 'contact.partage@example.com', '+905000000001', 'TR', null),
  ('Claire DUBOIS', 'physique', 'claire.dubois@example.com', '+41790000001', 'CH', null),
  ('Fatou SARR', 'physique', 'fatou.sarr@example.com', '+15550000001', 'CA', null),
  ('Mei LIU', 'physique', 'mei.liu@example.net', '+8613000000001', 'CN', null),
  ('Tarik OZTURK', 'physique', null, '+996550000001', null, 'Aucune adresse électronique au registre'),
  ('MERIDIEN SAS (P. MARTIN)', 'morale', 'p.martin@example.com', '+33600000001', 'FR', null),
  ('Deniz KAYA', 'physique', 'deniz.kaya@example.com', '+905000000002', 'TR', null),
  ('SCI BAOBAB', 'morale', 'sci.baobab@example.com', null, 'SN', 'Aucun numéro de téléphone au registre'),
  ('Ibrahima FALL', 'physique', 'ibrahima.fall@example.com', '+221700000005', 'SN', null),
  ('SCI ALIZE (BRANCHE C)', 'morale', 'sci.alize@example.com', '+221700000001', 'SN', null),
  ('Aminata CISSE', 'physique', 'aminata.cisse@example.com', '+221700000006', 'SN', null),
  ('Ousmane KANE (remplacement A. SECK)', 'physique', 'kaneousmane441', '+221700000007', 'SN', 'Adresse électronique invalide au registre : kaneousmane441'),
  ('Wei CHEN', 'physique', 'bureau.commun@example.org', '+221700000009', 'SN', null),
  ('Jun ZHAO', 'physique', 'bureau.commun@example.org', '+221700000010', 'SN', null)
),
ins as (
  insert into proprietaires (immeuble_id, nom, type, email, telephone, pays)
  select i.id, v.nom, v.typ::type_personne, v.mail, v.tel, v.pays
  from immeubles i, v
  where i.nom = 'Mamelles Tower'
  returning id, immeuble_id, nom
)
insert into proprietaires_notes (proprietaire_id, immeuble_id, note)
select ins.id, ins.immeuble_id, v.note
from ins join v on v.nom = ins.nom
where v.note is not null;

update proprietaires p set groupe_id = g.id
from proprietaires g
where g.nom = 'SCI ALIZE (groupe)' and g.immeuble_id = p.immeuble_id
  and p.nom like 'SCI ALIZE%' and p.est_groupe = false;

-- ---------------------------------------------------------------------
-- Les 62 lots — 10 000 tantièmes (valeurs réelles de l'état descriptif)
-- ---------------------------------------------------------------------
insert into lots (immeuble_id, numero, designation, niveau, etage, superficie_m2, tantiemes)
select i.id, v.num, v.des, v.niv, v.et, v.m2, v.tant
from immeubles i, (values
  (1, 'Espace polyvalent', 'Sous-sol', 0, 608, 524),
  (2, 'Espace polyvalent', 'Sous-sol', 0, 51, 45),
  (3, 'Salle polyvalente', 'RDC', 0, 148, 128),
  (4, 'Salle polyvalente', 'RDC', 0, 147, 127),
  (5, 'Salle polyvalente', 'RDC', 0, 260, 225),
  (6, 'Espace polyvalent', 'Mezzanine', 0, 281, 243),
  (7, 'Appartement 1A', '1er Étage', 1, 194, 166),
  (8, 'Appartement 1B', '1er Étage', 1, 174, 149),
  (9, 'Appartement 1C', '1er Étage', 1, 215, 185),
  (10, 'Appartement 1D', '1er Étage', 1, 142, 122),
  (11, 'Appartement 2A', '2ème Étage', 2, 194, 166),
  (12, 'Appartement 2B', '2ème Étage', 2, 174, 149),
  (13, 'Appartement 2C', '2ème Étage', 2, 215, 185),
  (14, 'Appartement 2D', '2ème Étage', 2, 142, 122),
  (15, 'Appartement 3A', '3ème Étage', 3, 194, 166),
  (16, 'Appartement 3B', '3ème Étage', 3, 174, 149),
  (17, 'Appartement 3C', '3ème Étage', 3, 215, 185),
  (18, 'Appartement 3D', '3ème Étage', 3, 142, 122),
  (19, 'Appartement 4A', '4ème Étage', 4, 194, 166),
  (20, 'Appartement 4B', '4ème Étage', 4, 174, 149),
  (21, 'Appartement 4C', '4ème Étage', 4, 215, 185),
  (22, 'Appartement 4D', '4ème Étage', 4, 142, 122),
  (23, 'Appartement 5A', '5ème Étage', 5, 194, 166),
  (24, 'Appartement 5B', '5ème Étage', 5, 174, 149),
  (25, 'Appartement 5C', '5ème Étage', 5, 215, 185),
  (26, 'Appartement 5D', '5ème Étage', 5, 142, 122),
  (27, 'Appartement 6A', '6ème Étage', 6, 194, 166),
  (28, 'Appartement 6B', '6ème Étage', 6, 174, 149),
  (29, 'Appartement 6C', '6ème Étage', 6, 215, 185),
  (30, 'Appartement 6D', '6ème Étage', 6, 142, 122),
  (31, 'Appartement 7A', '7ème Étage', 7, 194, 166),
  (32, 'Appartement 7B', '7ème Étage', 7, 174, 149),
  (33, 'Appartement 7C', '7ème Étage', 7, 215, 185),
  (34, 'Appartement 7D', '7ème Étage', 7, 142, 122),
  (35, 'Appartement 8A', '8ème Étage', 8, 194, 166),
  (36, 'Appartement 8B', '8ème Étage', 8, 174, 149),
  (37, 'Appartement 8C', '8ème Étage', 8, 215, 185),
  (38, 'Appartement 8D', '8ème Étage', 8, 142, 122),
  (39, 'Appartement 9A', '9ème Étage', 9, 194, 166),
  (40, 'Appartement 9B', '9ème Étage', 9, 174, 149),
  (41, 'Appartement 9C', '9ème Étage', 9, 215, 185),
  (42, 'Appartement 9D', '9ème Étage', 9, 142, 122),
  (43, 'Appartement 10A', '10ème Étage', 10, 194, 166),
  (44, 'Appartement 10B', '10ème Étage', 10, 174, 149),
  (45, 'Appartement 10C', '10ème Étage', 10, 215, 185),
  (46, 'Appartement 10D', '10ème Étage', 10, 142, 122),
  (47, 'Appartement 11A', '11ème Étage', 11, 194, 166),
  (48, 'Appartement 11B', '11ème Étage', 11, 174, 149),
  (49, 'Appartement 11C', '11ème Étage', 11, 215, 185),
  (50, 'Appartement 11D', '11ème Étage', 11, 142, 122),
  (51, 'Appartement 12A', '12ème Étage', 12, 194, 166),
  (52, 'Appartement 12B', '12ème Étage', 12, 174, 149),
  (53, 'Appartement 12C', '12ème Étage', 12, 215, 185),
  (54, 'Appartement 12D', '12ème Étage', 12, 142, 122),
  (55, 'Appartement 13A', '13ème Étage', 13, 194, 166),
  (56, 'Appartement 13B', '13ème Étage', 13, 174, 149),
  (57, 'Appartement 13C', '13ème Étage', 13, 215, 185),
  (58, 'Appartement 13D', '13ème Étage', 13, 142, 122),
  (59, 'Appartement 14A', '14ème Étage', 14, 194, 166),
  (60, 'Appartement 14B', '14ème Étage', 14, 174, 149),
  (61, 'Appartement 14C', '14ème Étage', 14, 215, 185),
  (62, 'Appartement 14D', '14ème Étage', 14, 142, 122)
) as v(num, des, niv, et, m2, tant)
where i.nom = 'Mamelles Tower';

-- ---------------------------------------------------------------------
-- Rattachement lot -> copropriétaire (pleine propriété)
-- ---------------------------------------------------------------------
insert into lot_proprietaires (lot_id, proprietaire_id, nature, quote_part, date_debut)
select l.id, p.id, 'pleine_propriete', 1, date '2025-09-01'
from lots l
join immeubles i on i.id = l.immeuble_id and i.nom = 'Mamelles Tower'
join (values
  (1, 'SCI ALIZE'),
  (2, 'SCI ALIZE'),
  (3, 'Awa TOURE'),
  (4, 'NDIAYE HOLDING'),
  (5, 'Awa TOURE'),
  (6, 'SCI ALIZE'),
  (7, 'NDIAYE HOLDING'),
  (8, 'NDIAYE HOLDING'),
  (9, 'NDIAYE HOLDING'),
  (10, 'NDIAYE HOLDING'),
  (11, 'HORIZON IMPORT EXPORT'),
  (12, 'Moussa BA'),
  (13, 'SCI ALIZE (BRANCHE B)'),
  (14, 'Kemal ARSLAN'),
  (15, 'Emre YILMAZ'),
  (16, 'SCI ALIZE'),
  (17, 'SCI ALIZE (BRANCHE B)'),
  (18, 'Claire DUBOIS'),
  (19, 'Fatou SARR'),
  (20, 'NDIAYE HOLDING'),
  (21, 'NDIAYE HOLDING'),
  (22, 'NDIAYE HOLDING'),
  (23, 'HORIZON IMPORT EXPORT'),
  (24, 'Mei LIU'),
  (25, 'SCI ALIZE (BRANCHE B)'),
  (26, 'Tarik OZTURK'),
  (27, 'MERIDIEN SAS (P. MARTIN)'),
  (28, 'MERIDIEN SAS (P. MARTIN)'),
  (29, 'SCI ALIZE'),
  (30, 'Deniz KAYA'),
  (31, 'NDIAYE HOLDING'),
  (32, 'SCI BAOBAB'),
  (33, 'SCI ALIZE (BRANCHE B)'),
  (34, 'NDIAYE HOLDING'),
  (35, 'Ibrahima FALL'),
  (36, 'SCI ALIZE'),
  (37, 'SCI ALIZE'),
  (38, 'Awa TOURE'),
  (39, 'SCI ALIZE (BRANCHE C)'),
  (40, 'Mei LIU'),
  (41, 'SCI ALIZE (BRANCHE C)'),
  (42, 'SCI ALIZE'),
  (43, 'SCI ALIZE (BRANCHE C)'),
  (44, 'Aminata CISSE'),
  (45, 'SCI ALIZE (BRANCHE C)'),
  (46, 'SCI ALIZE (BRANCHE C)'),
  (47, 'SCI ALIZE'),
  (48, 'Ousmane KANE (remplacement A. SECK)'),
  (49, 'SCI ALIZE (BRANCHE C)'),
  (50, 'NDIAYE HOLDING'),
  (51, 'Wei CHEN'),
  (52, 'Jun ZHAO'),
  (53, 'NDIAYE HOLDING'),
  (54, 'SCI ALIZE'),
  (55, 'Wei CHEN'),
  (56, 'NDIAYE HOLDING'),
  (57, 'SCI ALIZE'),
  (58, 'SCI ALIZE'),
  (59, 'NDIAYE HOLDING'),
  (60, 'MERIDIEN SAS (P. MARTIN)'),
  (61, 'MERIDIEN SAS (P. MARTIN)'),
  (62, 'MERIDIEN SAS (P. MARTIN)')
) as v(num, nom) on v.num = l.numero
join proprietaires p on p.nom = v.nom and p.immeuble_id = i.id;

-- ---------------------------------------------------------------------
-- Coordonnées de paiement FICTIVES
--
-- Le compte réel du syndicat n'existe pas encore (docs/06-decisions.md,
-- question n°1). Ce jeu fictif en porte un, inventé, pour que les appels
-- puissent être émis et le recouvrement raconté. Écrites directement : le
-- seed tourne hors session, sans les deux membres qu'exige la double
-- validation. Le déclencheur de l'immeuble en laisse la trace dans `journal`
-- (« première saisie », auteur inconnu).
-- ---------------------------------------------------------------------
update immeubles
   set compte_titulaire = 'Syndicat des copropriétaires Mamelles Tower (fictif)',
       compte_banque = 'Banque de démonstration (fictive)',
       compte_numero = 'SN000 00000 000000000000 00',
       compte_bic = 'DEMOSNDAXXX',
       moyens_paiement_acceptes = '{wave,orange_money,virement,virement_international,especes}'
 where nom = 'Mamelles Tower';

-- ---------------------------------------------------------------------
-- Exercice 2026 : trois trimestres appelés
--
-- Situation racontée au 26 septembre 2026 : un trimestre courant qui se porte
-- bien, un passé qui traîne.
--   - 4e trimestre, période en cours : appels émis le 15 septembre, échéance au
--     1er octobre ; environ 60 % encaissés, le reste à échoir — neuf propriétaires
--     soldés, trois partiels, sept pas encore payés ;
--   - 3e et 2e trimestres : environ 1 200 000 FCFA d'arriérés chez quatre
--     propriétaires. NDIAYE HOLDING, gros porteur (2 115 tantièmes), n'a réglé que
--     la moitié de chacun ; Tarik OZTURK doit le 3e, SCI BAOBAB et Ousmane KANE
--     le 2e.
-- Au 26/09/2026, le reste dû tombe donc dans trois tranches d'ancienneté :
-- à échoir (T4), 61-90 jours (T3, 87 jours) et au-delà de 90 jours (T2). Les
-- tranches 1-30 et 31-60 sont vides, et c'est normal : des appels trimestriels
-- ont des échéances espacées de 90 jours.
--
-- Montants FICTIFS (question ouverte n°4 : les montants réels ne sont pas
-- connus), identiques d'un trimestre à l'autre. Les postes d'ascenseur restent
-- à zéro : leur clé de répartition est contestée et c'est à l'assemblée de la
-- trancher (docs/03-regles-metier.md, § 1). L'échéance se lit sur le règlement
-- en vigueur (jour_exigibilite), pas sur une valeur inventée ici.
-- ---------------------------------------------------------------------
insert into exercices (immeuble_id, libelle, date_debut, date_fin)
select i.id, 'Exercice 2026', date '2026-01-01', date '2026-12-31'
from immeubles i where i.nom = 'Mamelles Tower';

insert into periodes (exercice_id, libelle, date_debut, date_fin, date_echeance, statut)
select e.id, v.libelle, v.debut, v.fin, v.debut + (r.jour_exigibilite - 1), 'brouillon'
from exercices e
join immeubles i on i.id = e.immeuble_id and i.nom = 'Mamelles Tower'
join reglements r on r.immeuble_id = i.id and r.en_vigueur,
(values
  ('2e trimestre 2026', date '2026-04-01', date '2026-06-30'),
  ('3e trimestre 2026', date '2026-07-01', date '2026-09-30'),
  ('4e trimestre 2026', date '2026-10-01', date '2026-12-31')
) as v(libelle, debut, fin)
where e.libelle = 'Exercice 2026';

insert into budget_lignes (periode_id, poste_charge_id, montant)
select per.id, pc.id, coalesce(m.montant, 0)
from periodes per
join exercices e on e.id = per.exercice_id
join immeubles i on i.id = e.immeuble_id and i.nom = 'Mamelles Tower'
join postes_charges pc on pc.immeuble_id = i.id
left join (values
  ('Électricité des parties communes', 900000),
  ('Eau des parties communes', 450000),
  ('Gardiennage et sécurité', 1200000),
  ('Nettoyage et entretien général', 600000),
  ('Entretien des espaces verts', 150000),
  ('Assurance de l''immeuble', 300000),
  ('Maintenance du groupe électrogène', 250000),
  ('Honoraires du syndic', 750000),
  ('Divers et imprévus', 200000)
) as m(libelle, montant) on m.libelle = pc.libelle;

-- Génération, puis émission quinze jours avant l'échéance. Mêmes fonctions que
-- l'application : quotes-parts, références, instantané figé à l'émission.
select app.generer_appels(per.id)
from periodes per
join exercices e on e.id = per.exercice_id
join immeubles i on i.id = e.immeuble_id and i.nom = 'Mamelles Tower'
order by per.date_debut;

update appels a
   set statut = 'emis', date_emission = per.date_echeance - 16
  from periodes per
 where per.id = a.periode_id and a.statut = 'brouillon';

update periodes per set statut = 'appele'
  from exercices e join immeubles i on i.id = e.immeuble_id and i.nom = 'Mamelles Tower'
 where e.id = per.exercice_id;

-- ---------------------------------------------------------------------
-- Paiements — par public.enregistrer_paiement, comme une saisie du syndic :
-- mêmes contrôles (pas de trop-perçu, pas de date future), statut de l'appel
-- suivi, trace dans `journal`. Part payée par trimestre : 1 = soldé,
-- 0 = impayé, entre les deux = partiel (arrondi au millier inférieur).
-- Date : `jour` jours après l'émission.
-- ---------------------------------------------------------------------
with v(nom, t2, t3, t4, moyen, jour) as (values
  ('SCI ALIZE (groupe)',                  1, 1, 1.0, 'virement', 3),
  ('NDIAYE HOLDING',                      0.5, 0.5, 0.0, 'virement', 2),
  ('HORIZON IMPORT EXPORT',               1, 1, 1.0, 'virement', 6),
  ('Awa TOURE',                           1, 1, 1.0, 'wave', 1),
  ('Claire DUBOIS',                       1, 1, 1.0, 'virement_international', 8),
  ('Fatou SARR',                          1, 1, 1.0, 'virement_international', 9),
  ('Mei LIU',                             1, 1, 1.0, 'virement_international', 10),
  ('MERIDIEN SAS (P. MARTIN)',            1, 1, 0.0, 'virement_international', 7),
  ('Ibrahima FALL',                       1, 1, 1.0, 'orange_money', 4),
  ('Aminata CISSE',                       1, 1, 1.0, 'wave', 2),
  ('Wei CHEN',                            1, 1, 1.0, 'especes', 5),
  ('Moussa BA',                           1, 1, 0.5, 'wave', 6),
  ('Deniz KAYA',                          1, 1, 0.3, 'virement_international', 9),
  ('Jun ZHAO',                            1, 1, 0.6, 'especes', 5),
  ('Kemal ARSLAN',                        1, 1, 0.0, 'virement_international', 10),
  ('Emre YILMAZ',                         1, 1, 0.0, 'virement_international', 10),
  ('Tarik OZTURK',                        1, 0, 0.0, 'virement_international', 10),
  ('SCI BAOBAB',                          0, 1, 0.0, 'virement', 8),
  ('Ousmane KANE (remplacement A. SECK)', 0, 1, 0.0, 'orange_money', 7)
),
a_payer as (
  select a.id, a.date_emission + v.jour as le, v.moyen::moyen_paiement as moyen,
         case when part.valeur = 1 then a.montant_total
              else floor(a.montant_total * part.valeur / 1000) * 1000 end as montant
  from appels a
  join periodes per on per.id = a.periode_id
  join proprietaires p on p.id = a.proprietaire_id
  join v on v.nom = p.nom
  cross join lateral (select case per.libelle
                               when '2e trimestre 2026' then v.t2
                               when '3e trimestre 2026' then v.t3
                               else v.t4 end::numeric as valeur) part
  where part.valeur > 0
)
select public.enregistrer_paiement(id, montant, moyen, le, null)
from a_payer
order by le, id;

-- ---------------------------------------------------------------------
-- Contrôles — le chargement échoue plutôt que de laisser passer un écart
-- ---------------------------------------------------------------------
do $$
declare
  v_lots int; v_tant int; v_liens int; v_props int; v_anom int; v_budget int;
  r record;
  v_total_du numeric; v_retard int; v_arrieres numeric;
begin
  select count(*), sum(tantiemes) into v_lots, v_tant from lots;
  select count(*) into v_liens from lot_proprietaires;
  select count(*) into v_props from proprietaires where est_groupe = false;
  select count(*) into v_anom  from proprietaires
   where est_groupe = false and (email is null or telephone is null or email not like '%@%');
  select count(*) into v_budget from budget_lignes;
  assert v_lots  = 62,    format('Attendu 62 lots, obtenu %s', v_lots);
  assert v_tant  = 10000, format('Attendu 10 000 tantièmes, obtenu %s', v_tant);
  assert v_liens = 62,    format('Attendu 62 rattachements, obtenu %s', v_liens);
  assert v_props = 21,    format('Attendu 21 entités distinctes, obtenu %s', v_props);
  assert v_anom  = 4,     format('Attendu 4 anomalies de contact, obtenu %s', v_anom);
  assert v_budget = 33,   format('Attendu 33 lignes de budget (11 postes × 3 trimestres), obtenu %s', v_budget);

  -- Recouvrement, trimestre par trimestre : appelé, encaissé, reste dû, et le
  -- nombre d'appels par statut. Toute dérive (quote-part, arrondi, paiement
  -- refusé ou en trop) arrête le chargement.
  for r in
    select per.libelle, per.date_echeance,
           count(a.id) as appels,
           sum(a.montant_total) as appele,
           coalesce(sum(pa.paye), 0) as encaisse,
           count(*) filter (where a.statut = 'solde') as soldes,
           count(*) filter (where a.statut = 'partiel') as partiels,
           count(*) filter (where a.statut = 'emis') as impayes
    from periodes per
    join appels a on a.periode_id = per.id
    left join lateral (select sum(montant) as paye from paiements
                       where appel_id = a.id and statut = 'confirme') pa on true
    group by per.libelle, per.date_echeance
    order by per.date_echeance
  loop
    assert r.appels = 19 and r.appele = 4800000,
      format('%s : attendu 19 appels pour 4 800 000 FCFA, obtenu %s pour %s', r.libelle, r.appels, r.appele);
    assert (r.libelle, r.date_echeance, r.soldes, r.partiels, r.impayes, r.encaisse) in (
      ('2e trimestre 2026', date '2026-04-01', 16, 1, 2, 4148760.00),
      ('3e trimestre 2026', date '2026-07-01', 17, 1, 1, 4233240.00),
      ('4e trimestre 2026', date '2026-10-01',  9, 3, 7, 2967280.00)),
      format('%s : échéance %s, %s soldés, %s partiels, %s impayés, %s FCFA encaissés — hors du jeu attendu',
             r.libelle, r.date_echeance, r.soldes, r.partiels, r.impayes, r.encaisse);
  end loop;

  -- Reste dû total ; arriérés : propriétaires et montant restant dus sur un
  -- trimestre antérieur au 4e (en retard quelle que soit la date de chargement).
  select sum(a.montant_total) - coalesce(sum(pa.paye), 0) into v_total_du
  from appels a
  left join lateral (select sum(montant) as paye from paiements
                     where appel_id = a.id and statut = 'confirme') pa on true;
  select count(distinct a.proprietaire_id), sum(a.montant_total) - coalesce(sum(pa.paye), 0)
    into v_retard, v_arrieres
  from appels a join periodes per on per.id = a.periode_id
  left join lateral (select sum(montant) as paye from paiements
                     where appel_id = a.id and statut = 'confirme') pa on true
  where per.libelle <> '4e trimestre 2026' and a.statut in ('emis', 'partiel');
  assert v_total_du = 3050720.00, format('Attendu 3 050 720 FCFA restant dus, obtenu %s', v_total_du);
  assert v_retard = 4, format('Attendu 4 propriétaires en retard sur T2 ou T3, obtenu %s', v_retard);
  assert v_arrieres = 1218000.00, format('Attendu 1 218 000 FCFA d''arriérés sur T2 et T3, obtenu %s', v_arrieres);

  raise notice 'Chargé : % lots, % tantièmes, % entités (19 comptes après regroupement), % anomalies, % lignes de budget, % FCFA restant dus',
    v_lots, v_tant, v_props, v_anom, v_budget, v_total_du;
end $$;

commit;
