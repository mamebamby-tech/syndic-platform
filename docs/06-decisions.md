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
| 31 | La dernière modification des coordonnées est signalée en permanence sur le tableau de bord, et sa date est visible des copropriétaires sur l'appel | Un copropriétaire qui voit la date changer peut vérifier auprès du cabinet avant de payer ailleurs. Pas de fenêtre de temps ni d'acquittement : ils demandent un paramètre et un état à conserver, dont rien ne dit encore qu'ils sont utiles. |
| 32 | `journal` n'est modifiable par aucun utilisateur, et un compte supprimé ne supprime pas ses traces (`acteur_id` passe à nul, `acteur_libelle` garde qui c'était) | Une trace qu'on peut effacer n'en est pas une. Avant, `acteur_id` empêchait de supprimer un compte ayant agi. |
| 33 | Le numéro de compte et les numéros marchands ne sont jamais réaffichés en clair (quatre derniers caractères) | Le tableau de bord est lu par tout le personnel, lecteurs compris. Le journal garde les valeurs complètes, pour l'audit. |
| 34 | Le journal et la date de modification utilisent `clock_timestamp()`, pas `now()` | `now()` est l'instant de la transaction : deux modifications dans la même transaction seraient indiscernables et leur ordre arbitraire. |

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
| **Un lecteur peut écrire presque partout** | Corrigé pour `immeubles` seulement. Les politiques `*_syndic` des autres tables (appels, paiements, proprietaires, lots, budget, journal exclu…) sont `for all` sur « tout membre du cabinet » : un lecteur peut les modifier. Un lecteur ne devrait rien écrire. | **Avant de donner un accès à un lecteur** : réserver l'écriture à `app.est_gestionnaire`, table par table, avec un test « un lecteur ne peut pas modifier » pour chacune. |
| **Le copropriétaire ne lit que son immeuble** | Les politiques `*_coproprietaire` de lots, règlement, clés, postes, exercices, assemblées, annonces et documents interrogent `proprietaires` sous sécurité par ligne, où le copropriétaire n'a aucune politique : elles renvoient toujours zéro ligne (vérifié). Corrigé pour `immeubles` (`app.immeubles_du_coproprietaire`). | L'espace copropriétaire sur téléphone (étape 7). Décision à prendre : élargir la lecture de ces huit tables. |
| Instantané des coordonnées à l'émission | Le document d'un appel déjà émis affiche les coordonnées **actuelles** de l'immeuble : si elles changent après l'émission, l'appel émis change avec elles. La date de modification visible sur l'appel le signale, sans figer ce qui a été envoyé. | L'envoi effectif des appels : le document envoyé doit être figé (PDF, `appels.document_path`). |
| Acquittement de l'alerte du tableau de bord | L'alerte sur la dernière modification est permanente. Un « vu » par personne, ou une fenêtre de temps, demande un état à conserver et un paramètre. | Le premier avis que l'alerte reste affichée trop longtemps. |
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
