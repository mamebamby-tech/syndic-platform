# Décisions et questions ouvertes

## Décisions prises

| # | Décision | Raison |
|---|---|---|
| 1 | Multi-tenant dès la première ligne de code | Rétrofitter le multi-tenant impose de réécrire schéma, droits d'accès et requêtes. Le surcoût initial est faible, le surcoût différé est une refonte. |
| 2 | Next.js + Supabase + Vercel | Authentification par code à usage unique native (SMS et courriel), sécurité par ligne adaptée au multi-tenant, stockage des documents, coût quasi nul au démarrage. |
| 3 | L'appel de fonds est adressé au propriétaire | 19 copropriétaires pour 62 lots : la consolidation est la valeur principale du produit. |
| 4 | Les règles du règlement sont des données | Elles diffèrent par immeuble et changent par vote. |
| 5 | Pénalités calculées, jamais appliquées automatiquement | 10 % par mois est un taux lourd ; l'appliquer est une décision humaine. |
| 6 | Identité par ligne `proprietaires`, jamais par courriel | Deux adresses du registre sont partagées par des personnes différentes. |
| 7 | Regroupement d'entités stocké et réversible | L'hypothèse SCI ALIZE n'est pas confirmée ; elle doit pouvoir tomber sans migration. |
| 8 | Charte dérivée de l'identité d'ENIGMA AFRICA | Les documents produits doivent ressembler à ceux du cabinet. |
| 9 | Aucune donnée personnelle réelle dans Git | Le dépôt porte un jeu fictif de structure identique ; le registre réel vit dans `donnees-privees/`, non versionné. L'historique a été réécrit le 19/09/2026 pour l'en purger. |
| 10 | Le nom du produit dans une constante unique | Il n'est pas arrêté et changera : le figer dans les composants coûterait une reprise complète. |
| 11 | `periodes` et `budget_lignes` isolées par immeuble en RLS | Leur politique d'origine (`using (true)`) ne filtrait sur aucun périmètre — une fuite de données entre cabinets. Corrigé en branchant l'écran Budget, avant qu'un utilisateur réel ne l'atteigne. |
| 12 | `app.generer_appels` exposée via une enveloppe `public.generer_appels` qui vérifie le périmètre | La fonction interne est `security definer` (elle doit pouvoir écrire pour tous les lots) : sans contrôle explicite, un utilisateur authentifié aurait pu générer les appels d'un immeuble qui n'est pas le sien. Le contrôle vit dans l'enveloppe, pas dans la fonction interne, pour que les tests et tâches serveur gardent un accès direct via une connexion Postgres. |
| 13 | Une période « courante » implicite, pas de sélecteur | Un seul exercice existe pour Mamelles Tower : Budget et Appels de fonds opèrent sur la période la plus récente. |
| 14 | `with check` toujours aussi strict que `using` — audit complet | `motifs_delai_renforce` et `types_majorite` avaient `using (true)` ; sept autres politiques avaient un `using` scopé mais un `with check (true)`, qui laissait un `insert` viser un autre cabinet sans qu'aucune lecture ne l'ait autorisé. Voir CLAUDE.md règle n°2 et `20260919040000_rls_with_check_audit.sql`. |
| 15 | Aucune requête directe sur `membres` avant cette session | L'audit a trouvé une récursion RLS infinie sur `membres` (une politique s'auto-référençait sans passer par une fonction `security definer`, contrairement à tout le reste du schéma) : `20260919050000_membres_rls_recursion.sql`. Bug présent depuis la migration d'origine, jamais atteint tant qu'aucun écran n'interrogeait `membres` directement. |
| 16 | La langue est une préférence de la personne, stockée en base (`membres.langue`, `proprietaires.langue`, défaut `fr`), sans préfixe d'URL | Un cabinet sert des propriétaires répartis sur cinq continents : la langue suit la personne, pas l'adresse. Un lien envoyé par WhatsApp s'ouvre dans la langue de celui qui le reçoit. La colonne est contrainte en format (deux lettres), pas en liste : ajouter une langue n'exige pas de migration. |
| 17 | Le français est la seule version opposable des documents juridiques ; une version de courtoisie traduite est prévue mais non générée | Appel de cotisation, convocation et procès-verbal sont rendus en français quelle que soit la langue de la personne. Le statut « non opposable » se **dérive** de la langue du document (`lib/i18n/document.ts`), il ne se règle pas : une version de courtoisie ne peut pas être marquée opposable par erreur. |
| 18 | Une clé absente d'une langue s'affiche en français | Une traduction incomplète dégrade la lecture ; elle ne doit jamais casser ou vider un écran d'appel de fonds. |
| 19 | XOF est le code stocké ; il s'affiche « FCFA » en français, « XOF » en anglais. Aucune conversion | « FCFA » est l'usage de tous les documents du cabinet. Seule l'étiquette change (`lib/i18n/valeurs.ts`), jamais la valeur. Un test interdit d'employer le format monétaire brut ailleurs, qui afficherait « XOF » à un lecteur français. |
| 20 | `next-intl` sans routage ; le navigateur ne reçoit que les espaces de noms des composants clients | Connexions lentes : les textes des documents et des gabarits de notification restent côté serveur. Le glossaire (`docs/07-glossaire.md`) doit être arrêté avant toute traduction. |
| 21 | « Charges communes » est le total du budget et inclut les ascenseurs ; « général » et « ascenseur » sont des catégories de suivi qui le décomposent | Le règlement (art. 15) range les ascenseurs parmi les charges communes. L'écran disait « Total général », « Total charges générales » et « Total ascenseurs », ce qui les présentait comme trois choses de même rang. Voir `docs/07-glossaire.md`. |
| 22 | L'anglais se formate en `en-GB` ; toute date juridique ou financière s'écrit avec le mois en toutes lettres | `10/01/2026` se lit le 10 janvier ou le 1er octobre selon le lecteur : inacceptable pour une échéance. Deux formats de date seulement (longue et abrégée, `dateJuridique` et `dateJuridiqueCourte`), tous deux avec le mois en lettres, gardés par un test sur le code source. Le code de langue en base reste `en`. |
| 23 | L'état d'envoi d'un appel se lit **par canal** : prêt, WhatsApp seulement, courriel seulement, injoignable | Les quatre anomalies du registre privent chacune d'un canal et en laissent un valide : aucun copropriétaire n'est injoignable. Un état global « bloqué » faisait croire que 4 personnes ne recevraient rien. Le numéro stocké est un numéro WhatsApp (intitulé de la colonne source). |
| 24 | La référence d'appel est un séquentiel court (`MT-2026T4-007`), gabarit paramétré par immeuble, unique par période | Dictable au téléphone, saisissable dans un libellé de virement. Le numéro de lot est écarté : un appel est adressé à un propriétaire, jamais à un lot (CLAUDE.md règle n°3). |
| 25 | Le document d'appel porte un bloc « Modalités de règlement » ; l'émission est refusée en base tant que les coordonnées bancaires du syndicat sont vides | Un appel sans indication de paiement envoyé à 19 copropriétaires ne se rattrape pas. Le contrôle est un déclencheur, pas un bouton grisé : aucune route oubliée ne peut le contourner. |
| 26 | Le premier du mois s'écrit « 1er » en français | Usage du français juridique ; Intl produit « 1 ». Post-traitement testé (`premierDuMois`), qui ne touche ni « 11 », « 21 » ni « 31 ». La forme abrégée « 1er oct. 2026 » est réservée aux tableaux denses (relevé). |
| 27 | Une organisation garde toujours au moins un `proprietaire_org` | Sans lui, plus personne ne peut administrer les membres (`membres_ecriture`) : seule une intervention en SQL réparerait. Déclencheur avec verrou d'organisation, sûr en concurrence. |

| 28 | Deux environnements : **syndic-dev** (jeu fictif : développement, tests) et **syndic** (base réelle : application déployée uniquement). La base réelle n'est modifiée que par l'application déployée et par des migrations appliquées délibérément | Les tests tournaient contre la base qui contient le registre réel : un exercice de test resté en base l'a prouvé, et une suite qui écrit peut aussi effacer. Un test ne doit jamais pouvoir écrire dans les données réelles. |
| 29 | La suite de tests s'arrête avant le moindre test si la base n'est pas le jeu fictif | Trois contrôles : URL différente de la base réelle (`.env.reel`, avant toute connexion), présence de « SCI ALIZE », aucune adresse hors `example.*`. Déclaré dans `vitest.config.ts`, re-vérifié par `connecter()`, gardé par des tests de structure : aucun oubli ne le désactive, et il n'existe aucune option pour le contourner. En cas de doute (schéma absent, réponse inattendue), il arrête. |

| 30 | Les coordonnées de paiement (compte, moyens acceptés, numéros marchands) ne sont modifiables que par le gestionnaire et le `proprietaire_org`, et chaque modification est tracée dans `journal` par déclencheur | C'est l'endroit où arrive l'argent de tous les copropriétaires : un IBAN modifié à mauvais escient le détourne sans qu'aucun calcul soit faux. Les garde-fous sont en base (RLS, déclencheur), pas dans l'écran : une route oubliée ne les contourne pas. Les numéros marchands en font partie. |
| 31 | Le tableau de bord signale une modification des coordonnées de paiement **en attente de confirmation** (qui, quand, avant → après, numéros masqués) ; l'alerte **disparaît à la confirmation**. La date de dernière modification est visible des copropriétaires sur l'appel | Un copropriétaire qui voit la date changer peut vérifier auprès du cabinet avant de payer ailleurs. Remplace l'alerte permanente sur la dernière modification (chantier 30) : avec la double validation, ce qui exige une action est la modification en attente ; ce qui est passé reste dans l'historique. |
| 32 | `journal` n'est modifiable par aucun utilisateur, et un compte supprimé ne supprime pas ses traces (`acteur_id` passe à nul, `acteur_libelle` garde qui c'était) | Une trace qu'on peut effacer n'en est pas une. Avant, `acteur_id` empêchait de supprimer un compte ayant agi. |
| 33 | Le numéro de compte et les numéros marchands ne sont jamais réaffichés en clair (quatre derniers caractères) | Le tableau de bord est lu par tout le personnel, lecteurs compris. Le journal garde les valeurs complètes, pour l'audit. |
| 34 | Le journal et la date de modification utilisent `clock_timestamp()`, pas `now()` | `now()` est l'instant de la transaction : deux modifications dans la même transaction seraient indiscernables et leur ordre arbitraire. |

| 35 | Au passage de brouillon à émis, la base fige sur l'appel (`appels.instantane`) une copie de tout ce que le document affiche ; le document d'un appel émis se rend **exclusivement** depuis elle | Un IBAN modifié après l'envoi changeait, rétroactivement, le document que les copropriétaires avaient reçu. Le déclencheur est en base : aucune route, oubliée ou future, ne peut émettre sans figer. Lecture stricte côté application : un instantané illisible fait échouer le rendu, jamais de repli sur les données courantes. |
| 36 | Un appel émis ne se modifie plus : la base refuse tout changement **hors son statut** (émis → partiel → soldé, ou annulé), y compris ses lignes et sa suppression. Jamais de retour à brouillon ; un appel annulé est terminal | Le statut suit les paiements : le geler interdirait de constater un paiement partiel. Corriger un appel émis = l'annuler et en émettre un autre, comme une facture. |
| 37 | Un seul appel **actif** par destinataire et par période (unicité partielle : les appels annulés ne comptent pas) | « Annulez-le et émettez-en un autre » n'est possible que si l'appel annulé ne bloque pas la place du nouveau. |
| 38 | Émettre un appel est réservé au gestionnaire et au `proprietaire_org` ; régénérer une période ne touche jamais un appel émis | `appels_syndic` laissait n'importe quel membre — lecteur compris — changer le statut d'un appel. L'ancien `generer_appels` ajoutait des lignes à l'appel existant du destinataire et recalculait le total de tous les appels : après émission, il aurait modifié un appel envoyé. |

| 39 | Modifier le budget après la génération marque les appels en brouillon de la période **obsolètes** ; la base refuse de les émettre tant qu'ils n'ont pas été régénérés | Sans cela, rien n'empêche d'envoyer à 19 copropriétaires des montants calculés sur un budget qui n'existe plus. Marquage par déclencheur, sur ce qui change les **montants appelés** (un montant qui s'ajoute, disparaît ou change ; la clé de répartition d'un poste) — pas sur un fournisseur ou une note, ni sur un enregistrement qui remet les mêmes valeurs : l'écran renvoie tout à chaque sauvegarde, marquer alors serait du bruit et apprendrait à ignorer l'alerte. |
| 40 | Une fois des appels émis (non annulés), le budget de la période est **verrouillé** en base : insertion, modification et suppression de ses lignes sont refusées | Le budget d'une période déjà appelée ne peut pas changer sous les appels émis. Si tous les appels émis sont annulés, il se rouvre. Le verrou est propre à la période. |
| 41 | Un utilisateur ne peut écrire dans `appels` que le **statut** et le report antérieur (droits de colonne) | Sinon l'indicateur d'obsolescence se remettait à faux à la main, ou un montant se changeait dans un brouillon avant émission. Un droit de colonne tient même si une politique est élargie un jour. La génération, `security definer`, n'est pas concernée. |
| 42 | Le bouton « Générer » est désactivé tant que le budget a des modifications non enregistrées ; « Enregistrer et générer » est l'action unique ; quitter la page avec des modifications est signalé | La génération lit le budget **enregistré** : générer avec des champs non enregistrés appellerait des montants que personne n'a validés. Limite connue : le bouton « précédent » du navigateur n'est pas intercepté (l'App Router ne l'expose pas) ; fermeture, rechargement, liens et sélecteur d'immeuble le sont. |

| 43 | **Double validation des coordonnées de paiement** : modifier le compte, les moyens acceptés ou un numéro marchand crée une **version en attente**, qui n'entre en vigueur qu'après confirmation par un **autre** membre habilité (gestionnaire ou `proprietaire_org`) que son auteur ; en attendant, les appels utilisent l'ancienne version | La trace (30) dit après coup qui a détourné l'argent ; la double validation empêche qu'un seul compte compromis, ou un seul membre distrait, y parvienne. La saisie initiale des coordonnées est soumise à la même règle : c'est là qu'une erreur coûte le plus. |
| 44 | Le compte, les moyens acceptés et les numéros marchands forment **un seul ensemble versionné** ; les utilisateurs perdent le **droit d'écrire** ces colonnes (droit de colonne) : la seule voie est proposer → confirmer | Le périmètre demandé était le compte et les numéros marchands ; j'y ai ajouté les moyens acceptés parce qu'un numéro marchand est lié à un moyen accepté par contrainte : les versionner séparément produirait des états incohérents (numéro Wave sans Wave accepté). Sans droit de colonne, un simple `update` contournait la règle. |
| 45 | « L'auteur ne confirme pas » est vérifié à **deux niveaux** : la fonction `confirmer`, et une contrainte de la table des versions qui tient même par SQL direct. Un cabinet à **un seul** membre habilité n'a **aucun contournement** : la modification reste en attente, et l'écran le dit | Une règle de sécurité qui a une exception « si le cabinet est petit » n'est plus une règle. Le blocage est un signal à traiter (question ouverte n° 12), pas un défaut à masquer. |
| 46 | **Le versant copropriétaire de la sécurité par ligne est inopérant pour l'essentiel et sera repris en entier**, avec des fonctions `security definer`, **en ouverture de l'étape « espace copropriétaire »** (étape 7 de CLAUDE.md) | Vérifié sur syndic-dev avec un copropriétaire ayant un appel et un paiement : seules `appels`, `appel_lignes`, `paiements` et `lot_proprietaires` lui répondent (leurs politiques appellent directement `app.proprietaires_de_lutilisateur()`) ; `immeubles` a été corrigée (`app.immeubles_du_coproprietaire`). Toutes les autres politiques `*_coproprietaire` — lots, règlement, clés de répartition, postes, exercices, assemblées, annonces, documents — passent par une sous-requête sur `proprietaires`, où le copropriétaire n'a aucune politique de lecture : elles renvoient toujours zéro ligne. Il lit donc les rattachements de ses lots sans pouvoir lire les lots. `periodes`, `budget_lignes`, `occupants` n'ont aucune politique copropriétaire. Corriger table par table au fil des écrans laisserait un versant à moitié ouvert et invérifiable : il sera repris **d'un seul tenant**, avec un test qui balaie toutes les tables comme le fait déjà `tests/rls-audit.test.ts` pour le versant cabinet. |
| 47 | **Le lecteur est en lecture seule, partout** : lecture pour tout le personnel du cabinet ; insertion, modification et suppression réservées au gestionnaire et au `proprietaire_org`, décidées par `app.est_gestionnaire()` (`app.immeubles_habilites()`) | Les politiques `*_syndic` étaient `for all` sur « tout membre du cabinet » : un lecteur pouvait **supprimer les 62 lots, les 22 propriétaires, le règlement de copropriété** (taux de pénalité, quorums, délais), les postes de charges, les exercices, les paiements et les votes. Mesuré par un balayage de toutes les tables (`tests/rls-audit.test.ts`), dans une transaction annulée. Corrigé en une migration générée à partir des politiques réellement présentes, avec une vérification finale qui échoue si une écriture reste ouverte à tout membre. Le balayage échoue désormais pour toute nouvelle table ouverte en écriture à un lecteur. |

## Questions ouvertes — ne pas y répondre à la place de l'utilisateur

### Bloquantes pour la mise en service

1. **Le syndicat des copropriétaires a-t-il un compte bancaire propre, et dans
   quelle banque ?** Préalable au branchement de l'agrégateur de paiement.
2. **Quel agrégateur mobile money ?** Wave et Orange Money passent par un
   intermédiaire. Décision commerciale : frais, délai de reversement, qualité du
   support local.
3. **Les trois entités SCI ALIZE sont-elles une seule personne morale ?**
   Détermine 19 ou 21 copropriétaires, et le poids du premier détenteur en
   assemblée (39,5 % contre 22,0 %).

12. **Qui est le second membre habilité d'ENIGMA AFRICA ?** La confirmation d'une
    modification des coordonnées de paiement exige un autre membre habilité que
    son auteur (décision 43). Le cabinet ne compte aujourd'hui qu'**un**
    `proprietaire_org` : tant qu'il n'y en a pas un second (gestionnaire ou
    propriétaire), aucune coordonnée bancaire ne peut entrer en vigueur, donc aucun
    appel ne peut être émis (l'émission exige des coordonnées renseignées). La règle
    n'est pas contournée ; il faut décider **qui**, et le déclarer dans `membres`.

### Chiffrage du budget

4. Montants des postes encore à zéro : électricité et eau des parties communes,
   assurance, groupe électrogène, honoraires du syndic, imprévus.
5. Montant et base des honoraires d'ENIGMA AFRICA (forfait, pourcentage, par lot).

### Juridiques

6. ~~Millièmes ou dix-millièmes ?~~ **Tranché le 19/09/2026.** La liste des lots
   et la liste des copropriétaires transmises par le syndic donnent des tantièmes
   totalisant 10 000. Le mot « millièmes » de l'article 15 est une formulation
   générique, pas une base de calcul.
7. **Clé de répartition des charges d'ascenseur.** Le règlement impose les
   tantièmes ; le rapport de gestion propose une pondération par étage. Une
   modification exige la majorité absolue et un délai de convocation de 20 jours.
8. Un conseil syndical a-t-il été élu lors de l'assemblée du 15 août 2026 ?
9. Le plafond de dépense engageable par le syndic sans accord préalable a-t-il
   été fixé par l'assemblée ?

### Produit

10. Combien de lots sont loués, et faut-il ouvrir un accès aux locataires en V1 ?
11. Les copropriétaires acceptent-ils de recevoir les appels par WhatsApp, ou
    faut-il réserver WhatsApp aux rappels et garder le courriel pour le document
    officiel ?

## Anomalies de données connues

Quatre contacts incomplets (lots 14, 26, 32, 48) — chacun privé d'un seul canal,
aucun copropriétaire injoignable — et deux adresses
électroniques partagées par des personnes différentes. Détail dans
`docs/03-regles-metier.md`, section 7. À corriger dans le registre source avant
toute mise en service, pas dans la base.

## Chantiers différés

| Chantier | Pourquoi plus tard | Ce qui le déclenche |
|---|---|---|
| Écran « Nouvel immeuble » | Tant qu'il n'y a qu'un immeuble, la saisie du règlement et l'import du registre se font en SQL. | Le deuxième immeuble confié au cabinet. |
| Page d'accueil publique | Les utilisateurs du pilote reçoivent un lien direct vers leur espace ; une vitrine ne leur sert à rien. | Le démarchage d'un cabinet tiers — et le choix du nom, dont elle dépend entièrement. |
| Expéditeur de courriel réel (SMTP) | Le service intégré de Supabase est bridé à quelques messages par heure et destiné aux tests. | **Avant toute mise en service** : dès que les 19 copropriétaires doivent recevoir un appel de fonds ou un code de connexion. Prestataire à choisir (Resend, Postmark ou équivalent). |
| Dépôt du règlement en PDF avec extraction des paramètres | Demande du travail et ne dispense jamais d'une validation humaine : une erreur de lecture se paierait en assemblée. | Le troisième immeuble, quand la saisie manuelle devient répétitive. Facturé comme prestation de démarrage, pas offert : c'est du conseil juridique outillé. |
| Historique des migrations appliquées | Aucune table ni outil ne dit quelles migrations sont appliquées à quelle base : elles s'appliquent en SQL direct. Avec deux bases, la dérive entre syndic-dev et la base réelle devient possible. | Le premier écart constaté entre les deux bases, ou l'installation de la CLI Supabase (`db push`, qui tient cet historique). |
| Le relevé compte les brouillons et les appels annulés | `chargerReleve` additionne `montant_total` de tous les appels, quel que soit leur statut : un brouillon, ou un appel annulé puis réémis, gonfle le « total appelé ». Devenu réel avec l'annulation d'appels émis. | Le prochain passage sur le relevé, ou l'enregistrement des paiements. |
| **Appel complémentaire et avoir** | Budget verrouillé après émission : toute correction d'un montant déjà appelé passera par un **appel complémentaire** (montant supplémentaire, avec son propre instantané) ou un **avoir** (montant en moins, imputé sur un appel futur ou remboursé). Ni l'un ni l'autre n'est construit : aujourd'hui, la seule correction possible est d'annuler l'appel émis et d'en émettre un autre, ce qui rouvre le budget si tous les appels émis sont annulés. À décider avec le cabinet : le vocabulaire du règlement, l'imputation d'un avoir, la trace dans `journal`. | Le premier écart constaté entre un budget appelé et la réalité des charges, ou l'enregistrement des paiements. |
| **Reprise du versant copropriétaire** | Voir la décision 46 : la sécurité par ligne côté copropriétaire est inopérante pour l'essentiel. | **Ouverture de l'étape « espace copropriétaire »**, avant tout écran : `app.immeubles_du_coproprietaire` généralisée, un test balayant toutes les tables. |
| Refus, remplacement et expiration d'une modification en attente | Une modification en attente peut être confirmée, refusée, retirée par son auteur, ou remplacée par une nouvelle proposition. Pas d'expiration : une modification oubliée reste en attente indéfiniment, et le tableau de bord la signale tant qu'elle existe. | Une modification restée en attente plus longtemps qu'on ne l'accepte. |
| Obsolescence : périmètre | Seuls le budget et la clé d'un poste rendent un brouillon obsolète. Un changement de tantièmes, de propriétaire d'un lot ou de règlement ne le fait pas : ces données changent rarement entre génération et émission, mais elles alimentent aussi le calcul. | Un premier brouillon émis sur des données périmées, ou la saisie des mutations de lots. |
| PDF de l'appel émis | L'instantané fige le contenu ; le fichier envoyé (PDF, `appels.document_path`) n'est pas encore produit. | L'envoi effectif des appels. |
| Clés de la base réelle hors du poste | `.env.reel` porte les clés réelles sur ce poste. Il n'est chargé par rien (ni Next.js, ni les tests, ni les scripts) et ignoré par git, mais il existe. | Le déploiement sur Vercel : les clés réelles n'ont alors plus à exister sur un poste. |
| Sélecteur de période sur Budget et Appels de fonds | Un seul exercice existe pour l'instant ; les deux écrans opèrent sur la période la plus récente. | Un deuxième trimestre chiffré pour Mamelles Tower. |
| Enregistrement manuel des paiements | Le relevé consolidé affiche mouvements et solde à partir des appels ; passer un paiement depuis l'écran attend la session des encaissements. | Prochaine session : paiements manuels et en ligne. |
| Changement de langue par la personne | La colonne existe, mais aucune politique ne laisse une personne modifier sa propre ligne : `membres_ecriture` est réservée au rôle `proprietaire_org`, et ouvrir l'`update` de sa propre ligne permettrait de changer son `role`. | La première traduction livrée. Passera par une fonction dédiée (`security definer`, périmètre vérifié) qui ne touche que `langue`, sur le modèle de `public.generer_appels`. |
| Traduction (`messages/en.json`) | Le glossaire n'est pas arrêté : traduire avant, c'est inventer des synonymes juridiques. | Les huit termes de `docs/07-glossaire.md` arrêtés par le cabinet, avec un juriste. |
| Version de courtoisie des documents | Demande l'anglais validé et une relecture juridique de la mention de non-opposabilité. La place est prévue (`versionDocument`, `Documents.mentions.courtoisie`). | La traduction et le glossaire ci-dessus. |
| Modèles WhatsApp par langue | Meta pré-approuve un modèle par langue ; une correction repasse par l'approbation. | L'envoi effectif (voir ci-dessous) et le glossaire. |
| Slogan du produit (`baseline`) traduisible | Il vit dans `lib/marque.ts` (règle n°6) et n'est lu que par le titre de page ; il reste en français tant que le nom n'est pas arrêté. | Le choix du nom du produit. |
| Envoi effectif des appels (WhatsApp, courriel) | **Le gabarit `appel_emis` est un brouillon** (`GABARITS_BROUILLON`, `lib/notifications/gabarits.ts`) : son texte doit être relu par le cabinet, et l'expéditeur devra refuser d'envoyer un brouillon à un destinataire réel. L'écran Appels de fonds signale déjà l'état d'envoi de chaque destinataire, par canal, mais n'envoie rien : aucun expéditeur de courriel réel n'est branché (voir chantier ci-dessus). | Le choix d'un prestataire de courriel transactionnel et la question ouverte n°11 (WhatsApp). |

## Points de vigilance sur les données

- **NDIAYE HOLDING n'a aucune ligne dans le fichier de coordonnées du syndic.**
  Vingt entités y figurent au lieu de vingt et une. Ce détenteur pèse 14 lots et
  21,1 % des tantièmes : son adresse n'existe que dans le classeur et doit être
  confirmée, faute de quoi un cinquième de l'immeuble ne reçoit jamais son appel.
- Les numéros du registre sont des **numéros WhatsApp** déclarés, pas des
  téléphones génériques — c'est l'intitulé de la colonne source.
- Les listes de lots et de copropriétaires parlent d'« acquéreur » et distinguent
  toujours les trois entités du groupe majoritaire, ce qui plaide pour trois
  acquéreurs juridiquement distincts sans le prouver.
