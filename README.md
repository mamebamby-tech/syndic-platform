# Plateforme de gestion de syndic

Gestion de copropriété multi-cabinet et multi-immeuble. Premier client :
ENIGMA AFRICA SARL (Dakar) — immeuble Mamelles Tower, 62 lots, 19 comptes
copropriétaires.

**Avant d'écrire du code, lis [`CLAUDE.md`](CLAUDE.md).** Il fixe cinq règles
dont la violation impose une réécriture.

## État du dépôt

Le socle de données est écrit. L'application Next.js existe : connexion par
code à usage unique, coquille de navigation avec sélecteur d'immeuble, registre
des lots en lecture seule. Les appels de fonds restent à construire.

- `supabase/migrations/` — schéma multi-tenant, sécurité par ligne, moteur de répartition
- `supabase/seed/seed.sql` — Mamelles Tower : 62 lots, 21 entités, règlement paramétré
- `docs/` — produit, modèle de données, règles métier, charte, écrans, décisions
- `app/`, `components/`, `lib/` — l'application Next.js
- `tests/` — tests du moteur de répartition, contre les fonctions SQL réelles

## Mise en route

### 1. Créer le projet Supabase

Sur [supabase.com](https://supabase.com), nouveau projet, région **Europe
(Francfort)** — la plus proche de Dakar parmi celles proposées. Note le mot de
passe de la base : il n'est plus affiché ensuite.

### 2. Installer les outils

```bash
npm install -g supabase
supabase --version
```

### 3. Lier le dépôt au projet

```bash
supabase login
supabase link --project-ref <ref-du-projet>
```

La référence du projet se lit dans son URL :
`https://supabase.com/dashboard/project/<ref-du-projet>`.

### 4. Appliquer le schéma et charger les données

```bash
supabase db push
psql "$DATABASE_URL" -f supabase/seed/seed.sql
```

Le seed se termine par des contrôles : 62 lots, 10 000 tantièmes, 62
rattachements, 21 entités. Il échoue plutôt que de charger un jeu incohérent.

### 5. Variables d'environnement

```bash
cp .env.example .env.local
```

Puis renseigne les valeurs depuis *Project Settings → API* dans Supabase.
`.env.local` n'est jamais versionné.

### 6. Lancer l'application

```bash
npm install
npm run dev
```

Sur `http://localhost:3000`, la connexion redirige vers `/login` tant
qu'aucune session n'est ouverte. Après une première connexion par code à
usage unique, il faut une ligne dans `membres` (organisation_id, user_id,
rôle) pour que le compte voie un immeuble — sinon la page d'accueil affiche
« Aucun immeuble accessible ».

```bash
npm run typecheck   # TypeScript strict
npm run lint        # ESLint
npm test            # tests du moteur de répartition, contre la base réelle
npm run types:db    # régénère lib/types/database.ts depuis le schéma (Docker requis)
```

## Conventions

- Le domaine parle français (`appels`, `tantiemes`, `proprietaires`), la
  technique parle anglais.
- Montants en `numeric(14,2)`, devise XOF, jamais de `float`.
- Toute nouvelle table arrive avec sa politique de sécurité par ligne dans la
  même migration.
