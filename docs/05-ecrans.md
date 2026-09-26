# Écrans validés

Les maquettes vivent sur un canvas Claude Design, propriété de l'auteur du
projet. Elles font foi pour la mise en page ; ce document fait foi pour le
comportement.

## Côté syndic — poste de travail, 1280 px

### Tableau de bord
**Règle : chaque chiffre mène à une action** — un lien vers une liste filtrée ou
vers l'écran qui permet d'agir. Un chiffre sans action n'y figure pas.

Construit, de haut en bas : la **période en cours** (décision 67 : la plus
récente dont l'appel a été émis, sinon la prochaine à venir ; exercice, trimestre,
échéance en toutes lettres, jours qui en séparent ; mène aux appels) ; le
**recouvrement de la période en cours** (appelé, encaissé, reste dû sur la
période, taux arrondi par défaut, une barre de progression) ; les cartes
**« à traiter »** : propriétaires en retard (nombre, montant échu, et la liste —
nom, échu, jours de retard, le plus ancien d'abord — avec le lien vers la liste
complète), ancienneté du reste dû **toutes périodes** avec son total, en tranches
comptées **par appel** (un propriétaire qui doit sur deux trimestres figure dans
deux tranches ; paramètre d'immeuble, voir `docs/03-regles-metier.md`), propriétaires
injoignables (aucun canal d'envoi : une anomalie, pas une statistique — sans
anomalie, pas de chiffre), coordonnées de paiement ; en bas, discret,
l'historique des cinq dernières modifications. Lisible sur téléphone.

**Un mot, un montant.** « Reste dû » est toujours qualifié : « sur la période »
(la période en cours) ou « toutes périodes ». Aucun écran ne présente deux
montants différents sous le même libellé.

**Coordonnées de paiement** — état (renseignées ou non, l'émission des appels est bloquée
tant qu'elles ne le sont pas), dernière modification, et **alerte sur la
modification en attente de confirmation** : quand, par qui, ce qui change (avant →
après, numéros masqués), avec le lien pour la vérifier. L'alerte **disparaît à la
confirmation** (ou au refus). C'est la page d'accueil de l'immeuble ; tout le
personnel la voit, lecteurs compris.

Pas encore construit : trésorerie, postes non chiffrés, échéances d'assemblée,
répartition du budget par poste.

### Comptes copropriétaires
La liste vers laquelle mènent les cartes du tableau de bord : un propriétaire
destinataire d'appels par ligne (un groupe compte pour un), avec son appelé,
son payé et son statut sur la période en cours (soldé, partiel, impayé), son
reste dû toutes périodes confondues et son plus ancien retard ; les plus gros
restes dus d'abord. Filtres par l'adresse : `?filtre=en-retard`, `reste-du`,
`injoignables`, ou `?anciennete=<tranche>` (`a-echoir`, `1-30`, …, `91-plus`).
Chaque nom mène au relevé du propriétaire.

**Sélecteur d'immeuble** en tête de la barre latérale : le cabinet en gère
plusieurs. Le logo du cabinet ne change pas, le nom de l'immeuble si.

### Paramètres de l'immeuble
Réservé au gestionnaire et au `proprietaire_org` ; un lecteur ne voit ni
l'entrée de menu ni le formulaire (et la base lui refuserait l'écriture de
toute façon). Trois sections : **coordonnées bancaires du syndicat** (titulaire,
banque, numéro ou IBAN, code SWIFT — requis dès que les virements internationaux
sont acceptés), **moyens de paiement acceptés** (Wave, Orange Money, virement,
virement international, espèces ; numéro marchand facultatif pour les deux moyens
mobiles), **référence des appels** (code de l'immeuble, format à jetons, exemple
en direct). Un compte partiellement rempli est signalé : l'émission reste
bloquée. Les coordonnées de paiement **ne se modifient pas directement** : en
enregistrer de nouvelles crée une modification **en attente**, affichée en tête de
la page (avant / après, en clair, pour comparer à la source) ; un **autre** membre
habilité que son auteur la confirme ou la refuse, l'auteur peut la retirer mais pas
la confirmer. Un cabinet à un seul membre habilité voit le blocage expliqué, sans
contournement. Toute modification est tracée et signalée sur le tableau de bord.

### Budget et clés de répartition
**Génération des appels.** Trois boutons : « Enregistrer le budget », « Générer les
appels de cette période » et l'action unique **« Enregistrer et générer »**. Tant
qu'il y a des modifications non enregistrées, « Générer » est désactivé avec le
message « Enregistrez le budget avant de générer les appels » ; quitter la page
(fermeture, rechargement, lien, sélecteur d'immeuble) demande confirmation. Si le
budget est modifié après la génération, les appels en brouillon sont **obsolètes** :
un bandeau l'indique sur Budget et sur Appels de fonds, et la base refuse de les
émettre tant qu'ils n'ont pas été régénérés. Une fois des appels émis, le budget
de la période est **verrouillé** (champs désactivés, bandeau) ; la correction
passera par un appel complémentaire ou un avoir (chantier différé).

Un poste par ligne : libellé, catégorie, fournisseur retenu, **clé de
répartition** (liste déroulante), montant. Total par catégorie et général.
Signalement des postes encore à zéro. Bandeau rappelant le point ouvert sur la
clé des charges d'ascenseur.

### Appels de fonds
Liste des appels générés, filtrable. Colonne « envoi » avec l'état **par
canal** de chaque destinataire : prêt, WhatsApp seulement, courriel seulement,
injoignable (rouge, seul état bloquant). Aperçu du document nominatif à droite,
à l'identité du cabinet, avec son bloc « Modalités de règlement » ; un bandeau
signale que l'émission est impossible tant que les coordonnées bancaires du
syndicat ne sont pas renseignées. Bouton d'envoi groupé, qui refuse les
destinataires injoignables plutôt que de les perdre en silence.

### Relevé consolidé
La fiche d'un copropriétaire : ses lots, ses tantièmes, son dû, ses mouvements.
Bandeau expliquant le regroupement d'entités quand il s'applique, et rappelant
qu'il est réversible.

### Assemblée générale
Ordre du jour avec, pour chaque résolution, **son type de majorité et chacune de
ses conditions chiffrées séparément**. Quorum de séance en tantièmes et en
nombre. Panneau d'écrêtement. Pouvoirs reçus. Bandeau de délai de convocation
calculé depuis l'ordre du jour.

## Côté copropriétaire — téléphone, 390 px

### Connexion
Téléphone ou adresse électronique, puis code à usage unique. Aucun mot de passe.
Le code part par SMS au Sénégal, par courriel à l'étranger.

### Accueil
Solde consolidé en tête — le total, pas le détail. Liste des lots avec leur
quote-part. Annonces. Barre de navigation : accueil, paiements, documents,
incidents.

### Paiement
Montant consolidé, choix du moyen (Wave, Orange Money, virement, virement
international) avec les frais annoncés, confirmation, reçu automatique.

## Règles d'interface transversales

- Un montant affiché est toujours explicable : au clic, le détail par poste et
  par lot.
- Une anomalie se montre là où l'on travaille, pas dans un rapport séparé.
- Rien qui engage juridiquement ne part sans contrôle préalable : envoi d'appel,
  convocation, application de pénalité.
- Les écrans du syndic supposent un grand écran ; les écrans copropriétaire
  supposent un téléphone d'entrée de gamme et une connexion lente.
