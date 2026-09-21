# Déploiement sur Vercel : démonstration et production

Ce document décrit la **démonstration** : l'application sur Vercel, reliée à **syndic-dev** (la
base fictive : Mamelles Tower, adresses en `example.*`). La base réelle n'y figure pas, et
**aucune de ses clés ne doit être saisie dans Vercel pour ce déploiement**.

Vérifié le 20/09/2026 sur le dépôt : le code de l'application lit **trois** variables, pas plus
(hors `NODE_ENV`, posée par Vercel).

## Le mode se déduit : la démonstration est l'état par défaut

L'application est en **production** si, et seulement si, `NEXT_PUBLIC_SUPABASE_URL` est
**exactement égale** à `URL_SUPABASE_PRODUCTION`. Dans tous les autres cas, elle est en
**démonstration** : bandeau « Version de démonstration — données fictives » sur chaque page,
`robots.txt` qui interdit tout, balise `noindex, nofollow`.

| Situation | Mode |
|---|---|
| `URL_SUPABASE_PRODUCTION` absente ou vide | démonstration |
| `URL_SUPABASE_PRODUCTION` différente de `NEXT_PUBLIC_SUPABASE_URL`, même d'un caractère (barre finale, majuscule, `http` au lieu de `https`, espace) | démonstration |
| `NEXT_PUBLIC_SUPABASE_URL` absente | démonstration (et l'application refuse de démarrer : elle en a besoin) |
| Les deux égales, non vides | **production** |

Un oubli de configuration donne donc une démonstration, jamais un site de production indexé.
La comparaison est volontairement stricte, sans aucune tolérance : une adresse légèrement fausse
retombe du bon côté. **En local** (`npm run dev`), `URL_SUPABASE_PRODUCTION` n'existe pas : le
bandeau s'affiche, ce qui est juste, les données étant fictives.

## Variables à saisir dans Vercel

Vercel : *Project > Settings > Environment Variables*, environnement **Production** (et
*Preview* si vous voulez des déploiements d'essai). Un déploiement se refait après chaque
changement : les variables `NEXT_PUBLIC_` sont **figées au build**, elles ne se lisent pas à
l'exécution.

### Pour la démonstration : deux variables

| Variable | Valeur | D'où elle vient | Visible du navigateur ? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<référence>.supabase.co` | Supabase, projet **syndic-dev** : *Project Settings > API > Project URL* | **Oui** — publique, part dans le navigateur |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé « anon » (jeton `eyJ…`) ou « publishable » (`sb_publishable_…`) | Supabase, projet **syndic-dev** : *Project Settings > API > Project API keys > anon / public* (ou *API Keys > Publishable key*) | **Oui** — publique par conception : c'est la sécurité par ligne qui protège les données |

### La variable qui bascule en production : à ne pas saisir pour la démonstration

| Variable | Valeur | D'où elle vient | Visible du navigateur ? |
|---|---|---|---|
| `URL_SUPABASE_PRODUCTION` | l'adresse de la **base réelle**, identique à la `NEXT_PUBLIC_SUPABASE_URL` du déploiement réel | Supabase, projet **de production** : *Project Settings > API > Project URL* — à saisir **uniquement** sur le déploiement réel | **Non — serveur uniquement** |

À retenir :

- **`URL_SUPABASE_PRODUCTION` est la seule variable serveur uniquement que lit l'application.** Elle ne porte pas le préfixe `NEXT_PUBLIC_`, donc Next.js ne la met jamais dans le navigateur. **Sur la démonstration, elle n'existe pas.**
- Les deux variables publiques peuvent être visibles de tous : **vérifiez que la seconde est bien la clé « anon »**, et non la clé « service_role » affichée juste en dessous sur le même écran de Supabase. L'application refuse de démarrer (erreur explicite dans les journaux) si le jeton de cette variable déclare le rôle `service_role`.
- Pour le **déploiement réel** (plus tard) : saisir `NEXT_PUBLIC_SUPABASE_URL` et `URL_SUPABASE_PRODUCTION` avec la **même** adresse. Si l'une est fausse, le déploiement reste en démonstration, visible immédiatement (bandeau, `robots.txt`) : rien n'est indexé.
- `NODE_ENV` est posée par Vercel : ne pas la saisir. En production, la route de connexion par lien (`/auth/confirmation`) n'existe pas : elle répond 404.

## Variables à ne pas saisir

| Variable | Pourquoi |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **Serveur uniquement, et l'application ne la lit jamais.** Elle contourne toute la sécurité par ligne. Seuls des scripts lancés depuis un poste (`npm run dev:lien`) la lisent. Ne la mettez pas dans Vercel : inutile ici, et une fuite donnerait tous les droits sur la base. Jamais avec le préfixe `NEXT_PUBLIC_`. |
| `DATABASE_URL` | **Serveur uniquement, non lue par l'application.** Connexion directe à Postgres (migrations, tests, seed) : réservée au poste de développement. |
| `NEXT_PUBLIC_SITE_URL` | Lue seulement par `npm run dev:lien`. L'adresse du site que Supabase Auth utilise se règle dans Supabase (voir ci-dessous), pas ici. |
| `PAIEMENT_*`, `WHATSAPP_*`, `EMAIL_*` | Aucun code ne les lit encore : ces intégrations ne sont pas construites (voir `docs/08-mise-en-service.md`). |
| Toute clé, URL ou mot de passe de la base **réelle**, sur la démonstration | Voir « Ce qui ne doit jamais arriver ». |

## Réglages de Supabase (syndic-dev), qui ne sont pas des variables

Sans eux, l'application se déploie mais **personne ne peut se connecter**.

| Où | Réglage | Pourquoi |
|---|---|---|
| *Authentication > URL Configuration* | **Site URL** = l'adresse Vercel de la démonstration ; l'ajouter aux *Redirect URLs* | Supabase construit ses liens à partir de cette adresse. |
| *Authentication > Emails > Templates* (modèle de connexion : « Magic Link », et « Confirm signup » pour un premier accès) | Le modèle doit contenir le **code** : `{{ .Token }}` | Le formulaire de connexion demande un **code à usage unique** saisi à la main. Un modèle qui n'enverrait qu'un lien laisse l'utilisateur sans code : la route de connexion par lien n'existe pas en production. |
| *Authentication > SMTP Settings* | Le service de courriel intégré suffit pour vous seul, pas pour des tiers | Le service intégré de Supabase est limité à deux messages par heure et refuse de livrer aux adresses qui ne sont pas membres de l'équipe (documentation Supabase, guides/auth/auth-smtp). Un tiers doit donc être ajouté à l'organisation Supabase de syndic-dev (décision 59, et la vérification B15 de `docs/08-mise-en-service.md` avant de le faire), ou un expéditeur SMTP réel doit être en place (chantier « Expéditeur de courriel réel »). |
| Base syndic-dev | Chaque compte de démonstration a une ligne dans `membres` | Sans elle, la connexion réussit et la page d'accueil affiche « Aucun immeuble accessible ». Voir `README.md`. |

## Après le déploiement : quatre contrôles

1. `https://<démonstration>/robots.txt` affiche `User-Agent: *` puis `Disallow: /`.
2. Le code source d'une page contient `<meta name="robots" content="noindex, nofollow"/>`.
3. Le bandeau « Version de démonstration — données fictives » s'affiche en haut de chaque page, y compris `/login`.
4. `https://<démonstration>/auth/confirmation` répond **404**.

Sur le déploiement **réel**, les contrôles 1 à 3 s'inversent (`Allow: /`, pas de balise, pas de bandeau) : c'est la preuve que `URL_SUPABASE_PRODUCTION` est exacte. Si le bandeau est encore là, la variable est absente ou différente : la corriger, puis redéployer.

Si `/login` répond 500 : ouvrir les journaux de la fonction dans Vercel. L'erreur nomme la variable absente (« `NEXT_PUBLIC_SUPABASE_URL` est absente ou vide… ») ; la saisir, puis **redéployer**.

## Clé service_role : ce qui a été vérifié

Audit du dépôt et du build, le 20/09/2026.

- **Aucune variable `NEXT_PUBLIC_` ne contient une clé de service** : les trois variables publiques du dépôt sont `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` et `NEXT_PUBLIC_SITE_URL` (`.env.example`, `.env.local`).
- **La clé « anon » de `.env.local` est bien une clé anon** : son jeton déclare le rôle `anon`.
- **Fichiers qui mentionnent `SUPABASE_SERVICE_ROLE_KEY`** : trois, aucun exécuté dans un navigateur.
  - `.env.example` : le nom, sans valeur, sans préfixe `NEXT_PUBLIC_`.
  - `scripts/dev-lien.ts` : script lancé à la main depuis un poste, sur syndic-dev seulement ; jamais déployé, jamais importé par l'application.
  - `tests/dev-lien.test.ts` : le test de ce script.
- **Aucune mention** dans `app/`, `lib/`, `components/`, `i18n/`, `proxy.ts`, `next.config.ts`.
- **Fichiers `'use client'`** (neuf) : aucun ne lit de variable autre que `NEXT_PUBLIC_`. Seul `lib/supabase/client.ts`, qu'ils utilisent, lit `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Sortie du build** : la clé de service, la chaîne `DATABASE_URL` et son mot de passe sont **absents** de `.next/static` (envoyé au navigateur) et de `.next/server`.
- Ces constats sont gardés par `tests/deploiement.test.tsx` : le test échoue si le code lit la clé de service, si une variable `NEXT_PUBLIC_` porte un secret, ou si ce document ne liste pas exactement les variables que le code lit.

## Ce qui ne doit jamais arriver

- Saisir dans Vercel une URL ou une clé de la base réelle pour la démonstration. La démonstration n'a pas accès à la base réelle par construction : `.env.reel` n'est ni versionné ni chargé par rien.
- Copier la clé « service_role » dans une variable `NEXT_PUBLIC_…`, ou dans Vercel tout court.
- Saisir `URL_SUPABASE_PRODUCTION` sur la démonstration, ou sur un déploiement relié à syndic-dev : elle serait égale à `NEXT_PUBLIC_SUPABASE_URL` si on la copiait, et la démonstration passerait en production, sans bandeau et indexable, avec des données fictives. La valeur est **toujours** l'adresse de la base réelle, jamais celle de syndic-dev.

## Limite connue du mode « noindex »

`robots.txt` interdit aux robots de parcourir le site, et la balise `noindex` leur demande de ne pas l'indexer. Un robot qui respecte l'interdiction ne lit pas la balise : une adresse citée ailleurs peut alors apparaître dans un moteur de recherche **sans contenu**. Aucun des deux ne protège l'accès : la démonstration reste protégée par la connexion.
