# Modèle de données — lecture guidée

Le schéma fait foi : `supabase/migrations/20260918090000_schema.sql`. Ce document explique
les choix qui ne se lisent pas dans le SQL.

## La chaîne de rattachement

```
organisations (cabinet de syndic)
  └── immeubles
        ├── reglements ──── motifs_delai_renforce
        │                └─ types_majorite
        ├── cles_repartition ──── postes_charges
        ├── lots ──── lot_proprietaires ──── proprietaires ──┐
        │        └─── occupants                              │ groupe_id
        ├── exercices ─── periodes ─── budget_lignes         │ (auto-référence)
        │                       └───── appels ─── appel_lignes
        │                                  ├───── paiements
        │                                  ├───── penalites
        │                                  └───── mises_en_demeure
        ├── assemblees ─── resolutions ─── votes
        │             ├─── convocations
        │             └─── presences
        └── documents, annonces, incidents, notifications
```

Tout descend d'`organisations`. C'est la frontière du locataire (tenant) : deux
cabinets ne partagent jamais une ligne.

## Trois décisions qui structurent tout

### L'appel est adressé à un propriétaire, pas à un lot

`appels` porte un `proprietaire_id` ; le détail par lot vit dans `appel_lignes`.
C'est l'inverse du classeur Excel, et c'est la raison d'être du produit. Un
propriétaire de 22 lots reçoit un document et règle une fois.

### Le regroupement d'entités est une donnée

`proprietaires.groupe_id` s'auto-référence. Trois entités « SCI ALIZE »
partagent un contact ; les traiter comme un seul copropriétaire est une
**hypothèse**, matérialisée par une ligne `est_groupe = true` vers laquelle les
trois pointent. Vider ces `groupe_id` fait repasser la copropriété de 19 à 21
comptes, sans toucher au code.

Ne déduis jamais un regroupement d'un contact commun : deux adresses du registre
réel sont partagées par des personnes sans lien.

### La référence d'un appel : courte, dictable, paramétrée par immeuble

`MT-2026T4-007` : code de l'immeuble (`immeubles.code_reference`), année et
période, numéro d'ordre. Elle se dicte au téléphone et se saisit dans un
libellé de virement : pas d'espace, pas de fragment d'identifiant technique.
Le gabarit est `immeubles.format_reference_appel` (défaut
`{code}-{annee}{periode}-{seq}`, jetons `{code}` `{annee}` `{periode}` `{seq}`,
`{seq}` obligatoire). Unique par période (`unique (periode_id, reference)`).

Le numéro d'ordre est un séquentiel et non le numéro de lot : un appel est
adressé à un propriétaire, jamais à un lot, et un propriétaire de 22 lots n'a
pas « un » numéro de lot. `appels.numero` est conservé à la régénération d'une
période pour qu'un numéro déjà porté par un appel émis ne soit jamais réutilisé.

### Les modalités de règlement sont des données de l'immeuble

`immeubles.compte_titulaire`, `compte_banque`, `compte_numero` (IBAN ou RIB,
aucun format imposé), `compte_bic` (facultatif) et `moyens_paiement_acceptes`.
Vides tant que le compte du syndicat n'existe pas (`docs/06-decisions.md`,
question n°1) : le document affiche « Coordonnées bancaires à renseigner », et
un déclencheur (`app.verifier_emission_appel`) **refuse de faire passer un appel
de `brouillon` à un statut émis** tant que titulaire, banque et numéro ne sont
pas tous renseignés. Le contrôle vit en base, pas dans l'écran.

**Les coordonnées de paiement** — compte du syndicat, `moyens_paiement_acceptes`
et `numeros_marchands` (Wave, Orange Money, un numéro par moyen mobile accepté) —
sont l'endroit où l'argent de tous les copropriétaires arrive : les modifier à
mauvais escient le détourne sans qu'aucun calcul soit faux. Trois garde-fous, en
base :

- **qui** : lecture pour tout le personnel, modification pour le gestionnaire et
  le `proprietaire_org`, création et suppression d'immeuble pour le
  `proprietaire_org` seul. Un lecteur ne modifie rien ;
- **trace** : chaque modification écrit une ligne de `journal` (avant, après,
  auteur, date) par déclencheur, hors de portée de tout utilisateur — `journal`
  n'a qu'une politique de lecture. `acteur_libelle` garde le courriel ou le
  numéro de l'auteur ; supprimer son compte ne supprime pas la trace ;
- **date** : `immeubles.compte_modifie_le` est posée par déclencheur, jamais
  saisie (une date antidatée est écrasée). Les copropriétaires la voient sur
  l'appel, pour repérer un changement de compte.

Le format de la référence (`code_reference`, `format_reference_appel`) est tracé
aussi, sous une autre action (`format_reference_modifie`), sans alerte.

### Un appel émis est figé

`appels.instantane` : copie de tout ce que le document affiche, prise par la base
au passage de brouillon à émis (référence, dates, destinataire, lignes, montants,
identité du cabinet, coordonnées bancaires, moyens, numéros marchands). Le
document d'un appel émis se rend **exclusivement** depuis cette copie
(`lib/appels/instantane.ts`, lecture stricte). Un appel émis ne se modifie plus
— ni ses lignes, ni sa suppression — sauf son **statut**, qui suit les paiements
(émis → partiel → soldé) ou va à annulé ; jamais de retour à brouillon. Corriger
un appel émis = l'annuler et en émettre un autre : l'unicité est donc partielle
(un seul appel *actif* par destinataire et par période). Régénérer une période
ne touche jamais un appel émis.

### Une organisation garde toujours un `proprietaire_org`

Sans lui, plus personne ne peut administrer les membres. Un déclencheur sur
`membres` refuse de retirer le rôle à la dernière ligne `proprietaire_org` :
suppression, rétrogradation, déplacement vers un autre cabinet, ou suppression
du compte. Supprimer l'organisation entière reste permis.

### La langue est une donnée de la personne

`membres.langue` (personnel du cabinet) et `proprietaires.langue`
(copropriétaire), défaut `fr`, contraintes en format (deux lettres) et non en
liste. Une valeur que l'application ne sert pas retombe sur le français. Comme
pour tout le reste, elle se rattache à la ligne `proprietaires`, jamais à une
adresse électronique. Les documents juridiques n'en dépendent pas : ils restent
en français, seule version opposable (`docs/06-decisions.md`, n° 17).

### Un lot peut avoir plusieurs détenteurs, et changer de mains

`lot_proprietaires` porte `nature` (pleine propriété, nue-propriété, usufruit,
indivision), `quote_part`, et un intervalle de dates. Une mutation crée une
nouvelle ligne et ferme l'ancienne — on ne modifie jamais l'historique, dont
dépendent les appels déjà émis.

## Le moteur de répartition

`supabase/migrations/20260918090200_repartition.sql`.

- `app.poids_lots(cle_id)` donne le poids de chaque lot pour une clé.
- `app.quote_part(poste_id, montant)` répartit un montant sur les lots.
- `app.destinataire_du_lot(lot_id, date)` remonte au groupe s'il existe.
- `app.generer_appels(periode_id)` produit les appels d'une période, sans doublon.
- `app.voix_assemblee(assemblee_id)` calcule les voix avec écrêtement éventuel.

Ajouter une clé de répartition = ajouter une ligne dans `cles_repartition`.
Ajouter une *méthode* de calcul = ajouter une branche dans `app.poids_lots` et
la documenter dans `docs/03-regles-metier.md`. C'est le seul endroit du code où
une règle de calcul a le droit d'exister.

## Sécurité par ligne

`supabase/migrations/20260918090100_rls.sql`. Deux portes, et aucune autre :

- le **personnel du cabinet**, via `membres`, accède à tout ce qui relève de son
  organisation ;
- le **copropriétaire**, via `acces_personnes`, accède à ses lots, ses appels,
  ses paiements, et aux documents qui lui sont destinés.

Un copropriétaire ne voit une pénalité que lorsqu'elle est `appliquee` : une
pénalité `calculee` est un brouillon interne.

Toute nouvelle table arrive avec sa politique dans la même migration.
