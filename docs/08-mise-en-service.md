# Mise en service — ce qui reste avant que le cabinet utilise la plateforme en réel

État au **20/09/2026**. Cette liste reprend les décisions, les questions ouvertes et les
chantiers de `docs/06-decisions.md`, y ajoute ce qu'une mise en réel exige et que ce
fichier-là ne disait pas (marqué **[ajout]**), et les met **dans l'ordre où il faut les
faire**.

## Qui agit

| Acteur | Qui | Ce qu'il fait |
|---|---|---|
| **Développement** | l'équipe qui écrit le code | fonctionnalités, tests, scripts, corrections |
| **Cabinet** | ENIGMA AFRICA SARL, ses deux associés | décisions du métier, données, validation, exploitation |
| **Concepteur** | le concepteur de la plateforme (décision 48 : il n'est **pas** membre du cabinet) | comptes et clés, déploiement, application des migrations sur la base réelle, choix de prestataires |

Un point qui demande deux acteurs les nomme tous les deux ; le premier agit d'abord.

**État** : **Fait** · **À faire** · **À décider** (aucun travail tant que la décision n'est pas prise) ·
**À vérifier**.

## Règle qui tient toute la liste

La base réelle n'est modifiée que par l'application déployée et par des migrations
appliquées **délibérément** (décision 28). Aucun point ci-dessous n'autorise un test, un
script de développement ou l'application locale à l'écrire. Pour la migration, la
confirmation est tapée à la main (décision 51).

---

## A. Décisions du cabinet, à demander en premier

Elles ne coûtent aucun code et déterminent le chiffrage, l'émission et l'envoi. Ce sont
elles qui ont le plus long délai : le budget est **verrouillé** dès qu'un appel est émis
(décision 40) ; un montant faux se corrige en annulant les appels et en réémettant.

| N° | Point | État | Qui | Détail |
|---|---|---|---|---|
| A1 | Le syndicat a-t-il un compte bancaire propre, dans quelle banque ? (question 1) | À décider | Cabinet | **Bloquant.** Sans coordonnées de paiement, la base refuse d'émettre un appel (décision 25). Préalable aussi au branchement de l'agrégateur. |
| A2 | Les trois entités SCI ALIZE sont-elles une seule personne morale ? (question 3) | À décider | Cabinet | **Bloquant pour les appels** : 19 ou 21 destinataires, donc un document ou trois pour ALIZE. Aujourd'hui le regroupement est une hypothèse stockée et réversible (décision 7). Pèse aussi sur les voix en assemblée. |
| A3 | Montants des postes encore à zéro : électricité et eau des parties communes, assurance, groupe électrogène, honoraires du syndic, imprévus (question 4) | À faire | Cabinet | **Bloquant.** À fournir avant de générer le premier appel. |
| A4 | Montant et base des honoraires d'ENIGMA AFRICA : forfait, pourcentage, par lot (question 5) | À décider | Cabinet | **Bloquant** pour le budget. |
| A5 | Clé de répartition des charges d'ascenseur (question 7) | À décider | Cabinet, puis assemblée | Le règlement impose les tantièmes, le rapport de gestion propose une pondération par étage. **Le développement ne tranche pas** (CLAUDE.md). Changer la clé exige la majorité absolue et 20 jours de convocation : si le premier appel doit partir avant, le cabinet dit quelle clé s'y applique. |
| A6 | Canal d'envoi des appels : WhatsApp, courriel, ou les deux (question 11) | À décider | Cabinet | Détermine ce qu'il faut brancher en D5 : courriel pour le document officiel et WhatsApp pour les rappels, ou l'inverse. |
| A7 | Relire le gabarit du message d'appel (`appel_emis`, brouillon) | À faire | Cabinet | Le texte est un brouillon (`GABARITS_BROUILLON`) ; l'expéditeur refusera d'en envoyer un à un destinataire réel tant qu'il n'est pas validé. |
| A8 | Corriger le registre **à la source** (le classeur), pas dans la base | À faire | Cabinet | Lots 14 et 32 : aucun numéro WhatsApp. Lot 26 : aucune adresse. Lot 48 : adresse invalide. Deux adresses partagées par des personnes différentes. **NDIAYE HOLDING n'a aucune ligne dans le fichier de coordonnées** : 14 lots, un cinquième des tantièmes, qui ne recevraient jamais leur appel. |
| A9 | Désigner les deux membres habilités : identité, adresse électronique, numéro (question 12, décision 48) | À faire | Cabinet | Les deux associés. À fournir au Concepteur pour B7. Tant qu'ils ne sont pas déclarés, aucune coordonnée bancaire ne peut entrer en vigueur, donc aucun appel ne peut être émis. |
| A10 | Choisir le nom du produit | À décider | Concepteur | Il vivra dans `lib/marque.ts` (décision 10). Il apparaît dans l'expéditeur des courriels et dans les documents : à arrêter avant D5. |
| A11 | Procédure de correction d'un appel émis | À décider | Cabinet | Aujourd'hui : annuler l'appel et en émettre un autre. Ni l'appel complémentaire ni l'avoir n'existent (chantier différé). Le cabinet accepte-t-il de démarrer ainsi, ou l'avoir passe-t-il avant la mise en service ? |
| A12 | Trop-perçu : un copropriétaire paie plus que le reste dû (question 13) | À décider | Cabinet | Refusé à la saisie aujourd'hui (décision 55). Imputé sur l'appel suivant, remboursé, ou avoir : à trancher avec A11. |
| A13 | Chèques : le cabinet en reçoit-il, et comment constater un chèque impayé ? (question 14) | À décider | Cabinet | Le moyen n'est pas offert à la saisie manuelle. Si oui, il demande une décision de conception avant d'être ajouté. |

## B. Infrastructure et base réelle

À faire **dans cet ordre** : chaque étape suppose la précédente.

| N° | Point | État | Qui | Détail |
|---|---|---|---|---|
| B1 | Deux environnements séparés (syndic-dev fictif, base réelle), garde-fou des tests | Fait | — | Décisions 28 et 29. Les tests refusent de démarrer sur une base qui n'est pas le jeu fictif. |
| B2 | Suivi des migrations appliquées par base, script d'écart et d'application | Fait | — | Décision 51 (`npm run db:etat`, `db:adopter`, `db:appliquer`). syndic-dev : historique en place, à jour. **Base réelle : écart mesuré le 20/09/2026, en lecture seule, sans rien y écrire : 14 migrations déjà appliquées, 7 manquantes** (`parametres_immeuble`, `instantane_appel`, `budget_appels_coherence`, `double_validation_coordonnees`, `lecteur_lecture_seule`, `notes_proprietaires`, `paiements_manuels`). Les 14 premières sont déduites de traces présentes, pas encore enregistrées. |
| B3 | Sauvegarde de la base réelle, avant toute migration puis à intervalle régulier ; vérifier qu'on sait la restaurer | À faire | Concepteur | **[ajout]** Une migration réécrit des politiques et supprime une colonne (`proprietaires.note`) : on ne l'applique pas sans point de retour. |
| B4 | Relire les sept migrations manquantes, dont `20260919140000` (coordonnées de paiement) | À faire | Concepteur | `npm run db:appliquer -- --cible=reel --essai` liste chaque fichier et ses instructions à relire, sans rien exécuter. **À vérifier** : la migration des coordonnées ne recopie pas les coordonnées déjà saisies dans `immeubles` vers l'historique versionné ; si la base réelle en contient, comment elles entrent dans le nouveau circuit (proposer, puis confirmer par l'autre associé). |
| B5 | Adapter le chargeur du registre privé (`donnees-privees/registre-mamelles-reel.sql`) à la table `proprietaires_notes` | À faire | Concepteur | **[ajout]** Il écrit encore `proprietaires.note`, colonne supprimée par `20260920010000` : il échouerait au rechargement. Fichier personnel, non versionné : pas modifié par le développement. La note va dans `proprietaires_notes`, comme dans le seed. |
| B6 | Adopter l'historique de la base réelle, puis appliquer les sept migrations | À faire | Concepteur | `npm run db:adopter -- --cible=reel`, puis `npm run db:appliquer -- --cible=reel` : chacun demande de taper une phrase qui nomme l'hôte et le nombre de migrations. Ensuite `npm run db:etat -- --cible=reel` doit afficher « aucun écart ». |
| B7 | Déclarer les deux associés dans `membres`, en SQL, rôle `proprietaire_org` ou `gestionnaire` | À faire | Concepteur | Après A9 et B6. **Le concepteur n'y figure pas** (décision 48). Vérifier ensuite qu'il y a bien deux membres habilités distincts : c'est la condition de la double validation (décision 45). |
| B8 | Comparer le catalogue de la base réelle à celui de syndic-dev, en lecture seule | À faire | Développement | **[ajout]** L'écart de B2 prouve que des objets sont présents, pas que la base réelle est identique : tables, colonnes, politiques, droits de colonne, déclencheurs. Un script lecture seule, comme `db:etat`, qui échoue sur toute différence. Le balayage de sécurité par ligne des tests ne peut pas tourner sur la base réelle (il écrit). |
| B9 | Déployer sur Vercel avec les clés réelles dans ses variables d'environnement | À faire | Concepteur | Puis retirer `.env.reel` du poste (chantier « Clés de la base réelle hors du poste »). Le déploiement de **démonstration** (syndic-dev, données fictives) est décrit à part dans `docs/09-deploiement.md`. Ce point-ci concerne le déploiement réel : y saisir aussi `URL_SUPABASE_PRODUCTION`, égale à l'adresse de la base réelle (variable serveur) ; **sans elle, le déploiement reste en démonstration** — bandeau, indexation interdite — ce qui est le bon côté d'un oubli. |
| B10 | Configurer l'authentification Supabase de la base réelle : URL du site, modèle de courriel qui envoie un **code** (le produit n'a pas de connexion par lien), limites de débit | À faire | Concepteur | **[ajout]** La route `/auth/confirmation` n'existe pas en production (décision 49) : un modèle de courriel qui enverrait un lien laisserait les gens sans connexion. |
| B11 | Expéditeur de courriel réel (SMTP) | À faire | Concepteur | **Bloquant** (chantier « Expéditeur de courriel réel »). Le service intégré de Supabase est limité à deux messages par heure et refuse de livrer aux adresses non membres de l'équipe (documentation Supabase, guides/auth/auth-smtp) : 19 copropriétaires qui se connectent le même jour le dépasseraient. Prestataire à choisir. Le domaine d'expédition demande une intervention du **Cabinet** sur son DNS (SPF, DKIM). |
| B12 | Fournisseur de SMS pour la connexion par téléphone, ou décider de n'ouvrir que le courriel au départ | À décider | Concepteur | **[ajout]** Le formulaire de connexion accepte un numéro ; sans fournisseur SMS configuré, ces connexions échouent. Décision à prendre avec A6. |
| B13 | Décalage d'horloge « JWT issued at future » | Fait | — | Décision 52 : nouvelle tentative bornée, connexion par code comme lien de développement. Journaux `[horloge]` à surveiller après le déploiement pour mesurer la fréquence réelle. |
| B14 | Le lecteur en lecture seule, la note d'un propriétaire réservée aux habilités | Fait | — | Décisions 47 et 50, sur syndic-dev. Effectif sur la base réelle **à la fin de B6**. |
| B15 | **Avant toute ouverture d'accès à un tiers** (démonstration autonome, ajout comme membre de l'organisation Supabase de syndic-dev : décision 59) : confirmer que **syndic-dev est seul dans son organisation Supabase** et que la **base réelle est dans une organisation distincte** | À vérifier | Concepteur | Dans Supabase : l'écran des organisations, la liste des projets de chacune et de ses membres. Un membre d'une organisation voit ses projets dans le tableau de bord, selon son rôle : si la base réelle partageait l'organisation de syndic-dev, ajouter un tiers lui ouvrirait la base réelle. Le **rôle accordé au tiers doit être le plus restreint que Supabase propose** ; la vérification porte sur **ce que ce rôle laisse voir**, la clé `service_role` de syndic-dev comprise. **Rien n'est ouvert à un tiers tant que ce point n'est pas « Fait »** ; consigner ici la date et le résultat. |

## C. Ce que le produit doit savoir faire pour un premier cycle complet

Un cycle : chiffrer, appeler, envoyer, encaisser, constater.

| N° | Point | État | Qui | Détail |
|---|---|---|---|---|
| C1 | Registre des lots et copropriétaires, budget par période et clés de répartition, génération des appels par propriétaire, aperçu du document nominatif, relevé consolidé, paramètres de l'immeuble | Fait | — | Étapes 1 à 6 de CLAUDE.md, côté syndic. |
| C2 | Coordonnées de paiement à double validation, gel de l'appel à l'émission, budget verrouillé après émission, obsolescence des brouillons | Fait | — | Décisions 25, 30–45. Sur la base réelle, après B6. |
| C3 | Le relevé ne compte que les appels émis, partiellement payés ou soldés | Fait | Développement | Décision 56. Ni brouillon (absent du relevé), ni appel annulé (affiché, non compté). Testé, dont : annuler, régénérer, réémettre un appel ne double pas le total. Sur la base réelle, avec le code déployé (B9). |
| C4 | Enregistrement manuel des paiements depuis l'écran | Fait | Développement | Décisions 53 à 55. Sur la fiche du propriétaire : virement, virement international, espèces, Wave et Orange Money, rattachés à un appel et à sa référence ; le statut de l'appel suit (émis, partiel, soldé) ; chaque paiement et chaque annulation sont tracés dans `journal` ; un paiement ne se modifie jamais, il s'annule par une écriture inverse avec motif. **Sur la base réelle : migration `20260920020000` (B6).** Ouvre deux questions au **Cabinet** : le trop-perçu (question 13) et le chèque (question 14), qui ne sont pas pris en charge. |
| C5 | PDF de l'appel émis | À faire | Développement | L'instantané fige le contenu ; le fichier (`appels.document_path`) n'est pas produit. |
| C6 | Envoi effectif des appels, par courriel puis WhatsApp | À faire | Développement | Suppose A6, A7, A10, B11. WhatsApp : compte Meta Business vérifié et **modèles pré-approuvés par Meta** — délai propre, à lancer tôt, par le **Cabinet** (titulaire du compte) avec le **Concepteur**. Un modèle par langue ; une correction repasse par l'approbation. |
| C7 | Espace copropriétaire sur téléphone (étape 7) | À décider | Concepteur | **Contrainte, dans tous les cas** : **ne créer aucun compte copropriétaire avant la reprise du versant copropriétaire de la sécurité par ligne** (décision 46), qui est inopérant pour l'essentiel (ses politiques inopérantes renvoient zéro ligne : elles échouent fermé, sans fuite entre cabinets). Question : le cabinet démarre-t-il avec le seul côté syndic, en envoyant les appels par courriel ? Si oui, C7 passe en section F. |

## D. Recette et lancement

| N° | Point | État | Qui | Détail |
|---|---|---|---|---|
| D1 | Rapprocher le registre affiché du classeur : 62 lots, 10 000 tantièmes, 21 entités (19 comptes si A2 les regroupe) | À faire | Cabinet | Sur la base réelle, après B6 et B7. Le seed fictif s'arrête de lui-même si un de ces totaux est faux ; pour le registre réel, c'est ce rapprochement qui le vérifie. |
| D2 | Rapprocher **un trimestre calculé par la plateforme** de celui du classeur Excel, propriétaire par propriétaire | À faire | Cabinet, avec Développement | Le calcul de répartition est testé au centime sur le jeu Mamelles Tower ; le rapprochement avec les chiffres réels du cabinet est ce qui le rend opposable en pratique. |
| D3 | Première saisie des coordonnées de paiement réelles : un associé les propose, l'autre les confirme | À faire | Cabinet | Pas de répétition possible sur la base réelle (les tests n'y écrivent jamais) : le premier essai est la saisie réelle, avec les coordonnées de A1. Le tableau de bord montre la modification en attente ; un associé seul ne peut pas la confirmer. La répétition se fait sur syndic-dev, avec des coordonnées fictives. |
| D4 | Protection des données personnelles : hébergement de la base réelle (région à confirmer), information et consentement des copropriétaires, formalités éventuelles | À vérifier | Cabinet, avec un juriste ; Concepteur pour la région | **[ajout]** Le registre réel contient noms, adresses, numéros et courriels de copropriétaires répartis sur cinq continents. Ce document ne dit pas ce que la loi applicable exige : à faire établir. |
| D5 | Émettre le premier appel réel | À faire | Cabinet | Dans cet ordre : A1–A5, B6–B7, D1–D3, puis C5–C6 pour l'envoi. Le suivi des paiements (C3, C4) est fait. |
| D6 | Fixer qui fait quoi : qui émet, qui confirme une coordonnée, qui saisit un paiement, comment corriger (A11) | À faire | Cabinet | **[ajout]** Deux associés seulement : la double validation impose que ce ne soit pas toujours le même qui propose et qui confirme. |

## E. Compléments qui peuvent suivre la mise en service

**Proposition, à confirmer par le Concepteur et le Cabinet** : aucun de ces points n'empêche
d'émettre, d'envoyer et d'encaisser le premier appel à la main. Chacun a un déclencheur, repris de
`docs/06-decisions.md`.

| Point | État | Qui | Ce qui le déclenche |
|---|---|---|---|
| Paiement en ligne via l'agrégateur (question 2 : Wave, Orange Money) | À décider | Cabinet (choix commercial), puis Développement | Le compte bancaire (A1) et le choix de l'agrégateur. Le développement ne choisit pas. À concevoir avec lui : un paiement en ligne naît « en attente » puis se confirme, ce qui heurte l'immuabilité des paiements (décision 54, chantier « Paiements en ligne et immuabilité »). |
| Espace copropriétaire, précédé de la reprise du versant copropriétaire de la sécurité par ligne (décision 46) | À faire | Développement | Le choix de C7. La reprise se fait d'un seul tenant, avec un test qui balaie toutes les tables. |
| Pénalités : calcul affiché, application ou remise par décision humaine enregistrée (décision 5) | À faire | Développement, décision du Cabinet | La première échéance dépassée. Jamais appliquées en silence. |
| Assemblées générales : convocations, quorum, majorités (étape 10) | À faire | Développement | La prochaine assemblée à préparer dans l'outil. |
| Conseil syndical élu le 15 août 2026 ? Plafond de dépense du syndic ? (questions 8 et 9) | À décider | Cabinet | L'écran des assemblées. |
| Combien de lots loués, accès locataires en V1 ? (question 10) | À décider | Cabinet | L'espace copropriétaire. |
| Appel complémentaire et avoir | À faire | Développement, décision du Cabinet | Le premier écart entre un budget appelé et la réalité (A11). |
| Rôle de support tracé, sans droit sur les coordonnées de paiement (décision 48) | À faire | Développement | Le premier besoin de dépannage sur la base réelle. |
| Traduction anglaise, version de courtoisie des documents, modèles WhatsApp par langue | À faire | Cabinet (glossaire, juriste), puis Développement | Les huit termes de `docs/07-glossaire.md` arrêtés. |
| Écran « Nouvel immeuble », page d'accueil publique, dépôt du règlement en PDF, sélecteur de période, périmètre de l'obsolescence, expiration des modifications en attente | À faire | Développement | Voir les déclencheurs dans `docs/06-decisions.md`, « Chantiers différés ». |
