# Déploiement de démonstration sur Vercel

Ce document décrit **uniquement** le déploiement de démonstration : l'application sur Vercel,
reliée à **syndic-dev** (la base fictive : Mamelles Tower, adresses en `example.*`). La base
réelle n'y figure pas, et **aucune de ses clés ne doit être saisie dans Vercel pour ce
déploiement** (voir « Ce qui ne doit jamais arriver »).

Vérifié le 20/09/2026 sur le dépôt : le code de l'application lit **trois** variables, pas plus.

## Variables à saisir dans Vercel

Vercel : *Project > Settings > Environment Variables*, environnement **Production** (et
*Preview* si vous voulez des déploiements d'essai). Un déploiement se refait après chaque
changement : les variables `NEXT_PUBLIC_` sont **figées au build**, elles ne se lisent pas à
l'exécution.

| Variable | Valeur | D'où elle vient | Visible du navigateur ? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<référence>.supabase.co` | Supabase, projet **syndic-dev** : *Project Settings > API > Project URL* | **Oui** — publique, part dans le navigateur |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé « anon » (jeton `eyJ…`) ou « publishable » (`sb_publishable_…`) | Supabase, projet **syndic-dev** : *Project Settings > API > Project API keys > anon / public* (ou *API Keys > Publishable key*) | **Oui** — publique par conception : c'est la sécurité par ligne qui protège les données |
| `DEMONSTRATION` | `1` | Ne vient pas de Supabase : c'est un réglage de ce déploiement | **Non — serveur uniquement** |

À retenir :

- **Une seule de ces trois est serveur uniquement : `DEMONSTRATION`.** Elle ne porte pas le préfixe `NEXT_PUBLIC_`, donc Next.js ne la met jamais dans le navigateur. Elle sert à afficher le bandeau, à poser `noindex, nofollow` et à écrire `robots.txt`.
- Les deux autres sont **publiques** : ne pas s'inquiéter qu'elles soient visibles, mais **vérifier que la seconde est bien la clé « anon »** et non la clé « service_role », affichée juste en dessous sur le même écran de Supabase. L'application refuse de démarrer (erreur explicite dans les journaux) si le jeton de cette variable déclare le rôle `service_role`.
- `DEMONSTRATION` vaut exactement `1`. Toute autre valeur (`true`, `oui`, `0`, vide) laisse le mode inactif.
- **`DEMONSTRATION=1` ne se pose jamais sur un déploiement relié à la base réelle** : le bandeau y affirmerait que les données sont fictives. Contrôle avant de saisir : l'hôte de `NEXT_PUBLIC_SUPABASE_URL` est celui de votre `.env.local` (syndic-dev), et **différent** de celui de `.env.reel`.
- `NODE_ENV` est posée par Vercel : ne pas la saisir. En production, la route de connexion par lien (`/auth/confirmation`) n'existe pas : elle répond 404.

## Variables à ne pas saisir

| Variable | Pourquoi |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **Serveur uniquement, et l'application ne la lit jamais.** Elle contourne toute la sécurité par ligne. Seuls des scripts lancés depuis un poste (`npm run dev:lien`) la lisent. Ne la mettez pas dans Vercel : inutile ici, et une fuite donnerait tous les droits sur la base. Jamais avec le préfixe `NEXT_PUBLIC_`. |
| `DATABASE_URL` | **Serveur uniquement, non lue par l'application.** Connexion directe à Postgres (migrations, tests, seed) : réservée au poste de développement. |
| `NEXT_PUBLIC_SITE_URL` | Lue seulement par `npm run dev:lien`. L'adresse du site que Supabase Auth utilise se règle dans Supabase (voir ci-dessous), pas ici. |
| `PAIEMENT_*`, `WHATSAPP_*`, `EMAIL_*` | Aucun code ne les lit encore : ces intégrations ne sont pas construites (voir `docs/08-mise-en-service.md`). |
| Toute clé, URL ou mot de passe de la base **réelle** | Voir « Ce qui ne doit jamais arriver ». |

## Réglages de Supabase (syndic-dev), qui ne sont pas des variables

Sans eux, l'application se déploie mais **personne ne peut se connecter**.

| Où | Réglage | Pourquoi |
|---|---|---|
| *Authentication > URL Configuration* | **Site URL** = l'adresse Vercel de la démonstration ; l'ajouter aux *Redirect URLs* | Supabase construit ses liens à partir de cette adresse. |
| *Authentication > Emails > Templates* (modèle de connexion : « Magic Link », et « Confirm signup » pour un premier accès) | Le modèle doit contenir le **code** : `{{ .Token }}` | Le formulaire de connexion demande un **code à usage unique** saisi à la main. Un modèle qui n'enverrait qu'un lien laisse l'utilisateur sans code : la route de connexion par lien n'existe pas en production. |
| *Authentication > SMTP Settings* | Vérifier ce que permet le service de courriel intégré | À vérifier : le service intégré de Supabase est bridé à quelques messages par heure et, selon la documentation de Supabase, n'envoie qu'aux adresses des membres de l'équipe du projet. Pour une démonstration devant des tiers, un expéditeur SMTP réel est nécessaire (chantier « Expéditeur de courriel réel »). |
| Base syndic-dev | Chaque compte de démonstration a une ligne dans `membres` | Sans elle, la connexion réussit et la page d'accueil affiche « Aucun immeuble accessible ». Voir `README.md`. |

## Après le déploiement : quatre contrôles

1. `https://<démonstration>/robots.txt` affiche `User-Agent: *` puis `Disallow: /` (et sans `DEMONSTRATION=1` : `Allow: /`).
2. Le code source d'une page contient `<meta name="robots" content="noindex, nofollow"/>`.
3. Le bandeau « Version de démonstration — données fictives » s'affiche en haut de chaque page, y compris `/login`.
4. `https://<démonstration>/auth/confirmation` répond **404**.

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
- Ces constats sont gardés par `tests/deploiement.test.tsx` : le test échoue si le code lit la clé de service, si une variable `NEXT_PUBLIC_` porte un secret, ou si `docs/09` ne liste pas exactement les variables que le code lit.

## Ce qui ne doit jamais arriver

- Saisir dans Vercel une URL ou une clé de la base réelle pour ce déploiement. La démonstration n'a pas accès à la base réelle par construction : `.env.reel` n'est ni versionné ni chargé par rien.
- Poser `DEMONSTRATION=1` sur le déploiement qui servira la base réelle : il interdirait l'indexation et affirmerait à tort que les données sont fictives. Le déploiement réel n'a pas cette variable.
- Copier la clé « service_role » dans une variable `NEXT_PUBLIC_…`, ou dans Vercel tout court.

## Limite connue du mode « noindex »

`robots.txt` interdit aux robots de parcourir le site, et la balise `noindex` leur demande de ne pas l'indexer. Un robot qui respecte l'interdiction ne lit pas la balise : une adresse citée ailleurs peut alors apparaître dans un moteur de recherche **sans contenu**. Aucun des deux ne protège l'accès : la démonstration reste protégée par la connexion.
