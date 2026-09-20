# Plateforme de gestion de syndic

Gestion de copropriété multi-cabinet et multi-immeuble. Premier client :
ENIGMA AFRICA SARL (Dakar) — immeuble Mamelles Tower, 62 lots, 19 comptes
copropriétaires.

**Avant d'écrire du code, lis [`CLAUDE.md`](CLAUDE.md).** Il fixe six règles
dont la violation impose une réécriture.

## État du dépôt

Le socle de données est écrit. L'application Next.js couvre : connexion par
code à usage unique, coquille de navigation avec sélecteur d'immeuble, registre
des lots, budget d'une période avec clés de répartition éditables, génération
et consultation des appels de fonds (avec aperçu du document nominatif), relevé
consolidé par propriétaire, paramètres de l'immeuble (coordonnées de paiement
tracées, référence des appels) et un tableau de bord réduit à ses alertes. L'encaissement des paiements et l'envoi
effectif (WhatsApp, courriel) restent à construire — voir
`docs/06-decisions.md`, « Chantiers différés ».

- `supabase/migrations/` — schéma multi-tenant, sécurité par ligne, moteur de répartition
- `supabase/seed/seed.sql` — Mamelles Tower : 62 lots, 21 entités, règlement paramétré
- `donnees-privees/` — registre réel, non versionné (voir `docs/06-decisions.md`)
- `docs/` — produit, modèle de données, règles métier, charte, écrans, décisions,
  glossaire (termes à arrêter avant toute traduction)
- `messages/` — textes d'interface (`fr.json` complet, `en.json` vide : la
  traduction attend le glossaire)
- `app/`, `components/`, `lib/` — l'application Next.js
- `tests/` — moteur de répartition, génération des appels, sécurité par ligne
  multi-cabinet ; contre les fonctions SQL de la base **de développement**
  (jeu fictif), jamais de la base réelle — voir « Environnements »

## Environnements

Deux projets Supabase, deux rôles qui ne se mélangent pas.

| | **syndic-dev** | **syndic** (base réelle) |
|---|---|---|
| Fichier local | `.env.local` | `.env.reel` — **jamais utilisé en local** |
| Données | jeu fictif : `supabase/seed/seed.sql` (Mamelles Tower, adresses en `example.*`) | registre réel d'ENIGMA AFRICA (`donnees-privees/`, non versionné) |
| Sert à | développement, tests, essais, validation des migrations | l'application **déployée** (Vercel), rien d'autre |
| Ses clés | `.env.local` | variables d'environnement de Vercel, pas des fichiers |

**La base réelle n'est modifiée que par deux choses : l'application déployée, et
des migrations appliquées délibérément.** Jamais par un test, un script de
développement ou l'application lancée en local. « Délibérément » : la migration
a d'abord été appliquée et vérifiée sur syndic-dev (d'abord en transaction
annulée), puis appliquée sur la base réelle **en la désignant explicitement**
— jamais en changeant `.env.local` pour l'occasion.

### Les tests ne tournent que sur le jeu fictif

La suite écrit dans la base (elle sème des lignes, génère des appels, modifie
des rôles). Un garde-fou (`tests/garde-environnement.ts`) l'**arrête
immédiatement**, avant le moindre test, avec un message qui dit pourquoi, si :

1. `DATABASE_URL` est vide, ou pointe vers l'hôte ou le projet listé dans
   `.env.reel` (contrôlé **avant** de se connecter) ;
2. la base ne contient pas l'entité « SCI ALIZE » du jeu fictif ;
3. un propriétaire a une adresse électronique hors des domaines réservés
   (`example.com`, `.org`, `.net`) — c'est-à-dire des données réelles.

Il ne se contourne pas par oubli : il est déclaré dans `vitest.config.ts`
(`globalSetup`, avant tout fichier de test), `connecter()` — seul moyen d'ouvrir
une connexion en test — le re-vérifie, et un test échoue si l'un des deux
disparaît ou si un test ouvre sa propre connexion. Il n'y a pas d'option pour le
désactiver : c'est voulu.

Les tests lisent `.env.local` et **seulement** lui. Attention à une variable
`DATABASE_URL` exportée dans votre shell : elle prime sur le fichier (le
garde-fou contrôle la valeur effective, donc il vous arrêtera).

`.env.reel` porte les clés de la base réelle sur ce poste. **Ne le renommez pas
> en `.env.production.local`** : Next.js charge ce nom automatiquement dès que
> `NODE_ENV=production` (`next build`, `next start`), y compris en local, et
> l'application se connecterait alors à la base réelle. `.env.reel` n'est chargé
> ni par Next.js, ni par les tests, ni par aucun script du dépôt ; il est ignoré
> par git (`.gitignore`). Le garde-fou lit quand même les deux noms, pour qu'un
> renommage par erreur ne le rende pas aveugle.

## Mise en route

Tout ce qui suit se fait sur **syndic-dev**, la base de développement.

### 1. Créer le projet Supabase

Sur [supabase.com](https://supabase.com), nouveau projet (`syndic-dev`), région
**Europe (Francfort)** — la plus proche de Dakar parmi celles proposées. Note le
mot de passe de la base : il n'est plus affiché ensuite.

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

`DATABASE_URL` est celle de **syndic-dev**. Le seed est le jeu **fictif** : il ne
se charge jamais sur la base réelle, dont le registre vient de `donnees-privees/`.

Le seed se termine par des contrôles : 62 lots, 10 000 tantièmes, 62
rattachements, 21 entités. Il échoue plutôt que de charger un jeu incohérent.

### 5. Variables d'environnement

```bash
cp .env.example .env.local
```

Puis renseigne les valeurs de **syndic-dev** depuis *Project Settings → API*
dans Supabase. `.env.local` n'est jamais versionné. Les clés de la base réelle
ne vont pas ici : voir « Environnements ».

### 6. Lancer l'application

```bash
npm install
npm run dev
```

**Se connecter sans attendre un courriel.** `npm run dev:lien <adresse>` affiche un
lien de connexion à usage unique pour un compte **existant** de syndic-dev, sans
envoyer de courriel :

```bash
npm run dev:lien mamebamby+dev2@gmail.com
```

Il refuse de s'exécuter si la base cible n'est pas syndic-dev (même garde-fou que
les tests : voir « Environnements »), ne crée jamais de compte, et le lien passe par
`/auth/confirmation`, une route qui n'existe pas en production. `npm run dev` doit
tourner. Le lien attend quelques secondes avant de rediriger : Supabase émet le
jeton avec l'horloge de son service d'authentification, et PostgREST le refuse
(« JWT issued at future ») s'il retarde, même d'une seconde.

Sur `http://localhost:3000`, la connexion redirige vers `/login` tant
qu'aucune session n'est ouverte. Après une première connexion par code à
usage unique, il faut une ligne dans `membres` (organisation_id, user_id,
rôle) pour que le compte voie un immeuble — sinon la page d'accueil affiche
« Aucun immeuble accessible ».

```bash
npm run typecheck   # TypeScript strict
npm run lint        # ESLint
npm test            # répartition, appels, RLS — contre syndic-dev (garde-fou : jeu fictif uniquement)
npm run types:db    # régénère lib/types/database.ts depuis le schéma (Docker requis)
```

## Conventions

- Le domaine parle français (`appels`, `tantiemes`, `proprietaires`), la
  technique parle anglais.
- Montants en `numeric(14,2)`, devise XOF (affichée « FCFA » en français), jamais de `float`.
- Toute nouvelle table arrive avec sa politique de sécurité par ligne dans la
  même migration.
