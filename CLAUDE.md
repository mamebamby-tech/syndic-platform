# Plateforme de gestion de syndic — instructions de travail

Lis ce fichier en entier avant d'écrire du code. Il fixe des règles qui ne se
négocient pas, parce que les enfreindre coûte une réécriture, pas une correction.

## Ce qu'on construit

Une plateforme web de gestion de copropriété pour un cabinet de syndic, conçue
dès le départ pour servir **plusieurs cabinets et plusieurs immeubles**.

Premier client : **ENIGMA AFRICA SARL**, cabinet de syndic à Dakar, qui gère
l'immeuble **Mamelles Tower** — 62 lots, 10 000 tantièmes, 19 comptes
copropriétaires. Cet immeuble est un jeu de données, pas la norme du produit.

Deux publics, deux interfaces :

- **Le syndic**, sur poste de travail : budget, appels de fonds, encaissements,
  relances, assemblées générales, documents.
- **Le copropriétaire**, sur téléphone : son solde, ses lots, son paiement, les
  annonces, les incidents.

Ce que le produit remplace : un classeur Excel qui oblige à envoyer un appel de
cotisation par lot. Un propriétaire de 22 lots recevait 22 documents pour le même
trimestre. C'est le problème à résoudre en priorité.

## Les cinq règles qui ne se négocient pas

### 1. Aucune règle juridique dans le code

Les délais, les taux, les quorums, les majorités, les clés de répartition sont
des **données**, lues dans la base, pas des constantes. Elles viennent du
règlement de copropriété, qui diffère d'un immeuble à l'autre et peut être
modifié par une assemblée générale.

```ts
// NON — cette ligne rend le produit mono-immeuble
const penalite = solde * 0.10;

// OUI
const { taux_penalite, penalite_par } = await reglementDe(immeubleId);
```

Si tu as besoin d'une règle qui n'existe pas encore comme paramètre, ajoute la
colonne ou la ligne de configuration, puis documente-la dans
`docs/03-regles-metier.md`. N'écris jamais la valeur en dur « en attendant ».

### 2. Multi-tenant à chaque requête

Toute table pend d'une `organisation_id` ou d'un `immeuble_id`. Aucune requête
ne sélectionne sans filtrer sur le périmètre de l'utilisateur. La sécurité par
ligne (RLS) est active sur toutes les tables et doit le rester : ne la désactive
jamais « pour déboguer », et n'utilise la clé de service qu'au sein de tâches
serveur explicitement isolées.

Avant de livrer une nouvelle table : écris sa politique RLS dans la même
migration. Une table sans politique est une fuite de données entre cabinets.

Toute politique a un `with check` aussi strict que son `using`. Le `using`
ne protège que la lecture et les lignes déjà existantes qu'une écriture
cible ; un `insert` n'a pas de ligne existante à filtrer, donc rien à part
le `with check` ne l'empêche de viser un autre cabinet. `with check (true)`
sur une politique par ailleurs bien scopée est la même fuite que
`using (true)`, seulement en écriture — voir
`supabase/migrations/20260919040000_rls_with_check_audit.sql` pour l'audit
qui l'a trouvée dans sept politiques du schéma d'origine.

### 3. L'argent ne se devine pas

- Les montants sont en **XOF** (franc CFA), sans décimale à l'affichage, stockés
  en `numeric(14,2)`. Jamais de `float`.
- Un appel de fonds est adressé à un **propriétaire**, jamais à un lot. Le détail
  par lot est une ligne d'appel.
- Toute somme affichée doit être traçable : quel poste, quelle clé, quel poids.
- Une pénalité est **calculée** puis **appliquée ou remise** par une décision
  humaine enregistrée. Jamais appliquée en silence.
- Tout mouvement d'argent laisse une trace dans `journal`.

### 4. L'identité d'un copropriétaire n'est pas son adresse électronique

Le registre réel contient deux adresses partagées par des personnes
**différentes** (`contact.partage@example.com`, `bureau.commun@example.org`). Identifier
par l'email ferait fusionner deux comptes et exposerait le solde de l'un à
l'autre. L'identité est la ligne `proprietaires`, rien d'autre.

Le regroupement d'entités d'un même ayant droit (`proprietaires.groupe_id`) est
une donnée réversible, jamais une déduction faite par le code à partir d'un
contact commun.

### 5. Les couleurs et les espacements vivent à un seul endroit

Aucune valeur hexadécimale dans un composant. Tout passe par les jetons définis
dans `docs/04-charte.md` et la configuration Tailwind. Changer l'accent doit
rester une modification d'une ligne.

### 6. Le nom du produit n'est pas arrêté

Il vivra dans une seule constante — `lib/marque.ts`, exportant `nom`,
`nomCourt` et `baseline`. Ne l'écris jamais en dur dans un composant, un
gabarit de courriel ou un document PDF. Le renommer doit rester une
modification d'une seule ligne.

## Pile technique

| | |
|---|---|
| Framework | Next.js (App Router), TypeScript strict |
| Base et authentification | Supabase — Postgres, Auth par code à usage unique (SMS et courriel), Storage |
| Styles | Tailwind CSS, jetons dans `tailwind.config.ts` |
| Déploiement | Vercel |
| Paiements | agrégateur mobile money (Wave, Orange Money) — non choisi, voir `docs/06-decisions.md` |
| Messages | WhatsApp Business (Meta Cloud API) et courriel |

Contraintes de terrain : connexions mobiles lentes, propriétaires répartis sur
cinq continents. Les pages doivent rester utilisables sur un téléphone d'entrée
de gamme et une connexion irrégulière.

## Langue et vocabulaire

Le domaine est juridique et francophone. **Le code parle français** pour les
entités métier : `appels`, `lots`, `tantiemes`, `proprietaires`, `reglements`,
`quoteParts`. Les termes techniques restent en anglais (`useState`, `fetch`).

N'invente pas de synonymes : un `appel de fonds` n'est pas une `facture`, un
`tantième` n'est pas une `part`, un `copropriétaire` n'est pas un `client`.
Le vocabulaire du règlement fait foi.

## Ce qui existe déjà dans ce dépôt

```
supabase/migrations/20260918090000_schema.sql      schéma multi-tenant complet
supabase/migrations/20260918090100_rls.sql         sécurité par ligne, deux populations
supabase/migrations/20260918090200_repartition.sql moteur de répartition et voix en AG
supabase/seed/seed.sql                   Mamelles Tower : 62 lots, 21 entités, RCP paramétré
docs/01-produit.md                       périmètre, utilisateurs, ce qui est hors sujet
docs/02-modele-donnees.md                lecture guidée du schéma
docs/03-regles-metier.md                 les règles du RCP, article par article
docs/04-charte.md                        couleurs, typographie, composants
docs/05-ecrans.md                        les huit écrans validés
docs/06-decisions.md                     décisions prises et questions ouvertes
```

L'application Next.js **reste à créer**. C'est le premier chantier.

## Ordre de construction suggéré

1. Application Next.js, connexion Supabase, authentification par code à usage unique.
2. Sélecteur d'immeuble et coquille de navigation (le syndic gère plusieurs immeubles).
3. Registre des lots et des copropriétaires, en lecture puis en édition.
4. Budget par période, postes et clés de répartition.
5. Génération des appels de fonds et document nominatif en PDF.
6. Relevé consolidé par propriétaire et enregistrement manuel des paiements.
7. Espace copropriétaire sur téléphone.
8. Paiement en ligne via l'agrégateur retenu.
9. Notifications WhatsApp et courriel.
10. Assemblées générales, convocations, calcul des majorités.

Ne saute pas l'étape 2 : coder un seul immeuble « pour commencer » est
exactement la dette qu'on cherche à éviter.

## Tests

Le calcul de répartition et le calcul des majorités sont les deux endroits où
une erreur se voit en justice. Ils sont testés avant d'être branchés à une
interface, avec le jeu Mamelles Tower comme référence :

- 62 lots, 10 000 tantièmes, la somme des quotes-parts égale le montant appelé
  au centime près ;
- SCI ALIZE groupé pèse 3 946 tantièmes et 22 lots ; dégroupé, la plus grosse
  entité pèse 2 197 tantièmes et 12 lots ;
- une résolution à majorité absolue échoue si l'une des deux conditions manque.

## Ce qu'il ne faut pas faire sans demander

- Choisir l'agrégateur de paiement — décision commerciale, pas technique.
- Appliquer automatiquement les pénalités de retard.
- Trancher la clé de répartition des charges d'ascenseur : le rapport de gestion
  et le règlement se contredisent, c'est à l'assemblée générale de décider.
- Modifier les valeurs du seed sans vérifier la source dans `docs/03-regles-metier.md`.
- Écrire des données personnelles réelles dans des fixtures de test publiques.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
