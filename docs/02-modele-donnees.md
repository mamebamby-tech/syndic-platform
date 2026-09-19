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
