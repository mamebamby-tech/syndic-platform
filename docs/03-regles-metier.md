# Règles métier — ce que dit le règlement, ce que fait le code

Chaque règle ci-dessous est **paramétrée**, jamais codée. La colonne « où »
indique le paramètre qui la porte. Les valeurs sont celles de Mamelles Tower ;
un autre immeuble a d'autres valeurs.

Source : règlement de copropriété de la SCI Mamelles Tower, déposé le
1er septembre 2025 par-devant Me Tabara Mathurin DIOP, notaire associée, Charge
de Dakar XX. Loi sénégalaise n°88-04 du 16 juin 1988 portant statut de la
copropriété des immeubles bâtis.

## 1. Assiette de répartition

| Règle | Article | Valeur | Où |
|---|---|---|---|
| Les charges communes sont supportées au prorata de la part dans les choses communes, exprimée en millièmes de l'état descriptif | 15 | tantièmes | `cles_repartition.methode = 'tantiemes'` |
| Base des tantièmes | 7 | 10 000 | `reglements.base_tantiemes` |

**Point ouvert.** Le règlement écrit « millièmes » ; le registre du syndic compte
sur 10 000. À vérifier sur l'état descriptif de division lui-même. Le paramètre
existe pour que la réponse ne change rien au code.

**Les ascenseurs.** L'article 15 point 2 range les ascenseurs parmi les
équipements à usage collectif dont les frais sont des charges communes. Il ne
prévoit **aucune** pondération par étage ni exonération du socle. Le rapport de
gestion du 17/09/2026 propose l'inverse. La clé `ponderation_etage` existe dans
le seed pour permettre de simuler cette proposition, mais la clé en vigueur est
`tantiemes` tant qu'une assemblée n'a pas tranché — à la majorité absolue, qui
est une double majorité (§ 4).

## 2. Appels de fonds

| Règle | Article | Valeur | Où |
|---|---|---|---|
| Recouvrement trimestriel, par compte à échoir | 17 | `trimestriel` | `reglements.periodicite_appel` |
| Provision due le premier jour de chaque trimestre | 16 | 1 | `reglements.jour_exigibilite` |
| Règlement dans le mois suivant l'envoi de l'arrêté de compte | 16 | 30 jours | `reglements.delai_paiement_jours` |
| Comptes annuels arrêtés dans les six mois et soumis à l'assemblée | 16 | — | à traiter dans le module Exercices |
| Le paiement des charges ne vaut pas approbation des comptes | 16 | — | ne jamais clore un exercice sur des encaissements |

Le fonds de roulement (« provision ») est distinct des appels trimestriels et
doit rester intact : l'appel ne s'impute jamais dessus.

**Solidarité.** En indivision comme en démembrement (nue-propriété / usufruit),
les détenteurs sont solidairement tenus de la totalité due sur le lot. D'où
`lot_proprietaires.nature` et `quote_part` : le modèle sait représenter
plusieurs détenteurs sur un lot, et la dette reste attachée au lot.

## 3. Retard et recouvrement

| Règle | Article | Valeur | Où |
|---|---|---|---|
| Intérêts de retard | 17 | **10 % par mois** | `reglements.taux_penalite`, `penalite_par` |
| Exigibilité des intérêts | 17 | après mise en demeure restée infructueuse | `penalite_requiert_mise_en_demeure` |
| Application | — | décision du syndic | `penalite_automatique = false` |

Dix pour cent par mois, soit cent vingt pour cent l'an. Le taux est celui du
règlement, mais son application à un copropriétaire est une décision lourde.
La plateforme **calcule** la pénalité, l'affiche, et exige un geste explicite
pour l'appliquer ou y renoncer — avec l'auteur et le motif enregistrés
(`penalites.statut`, `decide_par`, `motif`).

Garanties de recouvrement (articles 18 et 27), à surfacer comme actions et non
à automatiser : hypothèque légale sur le lot, saisie-attribution des loyers du
locataire, saisie du mobilier, adjudication judiciaire du lot. Les frais de
procédure restent à la charge du copropriétaire défaillant.

## 4. Assemblées générales

### Convocation

| Règle | Article | Valeur | Où |
|---|---|---|---|
| Délai normal | 30-1 | 10 jours | `reglements.delai_convocation_jours` |
| Délai renforcé | 30-2 | 20 jours | `reglements.delai_convocation_renforce_jours` |
| Cas déclenchant le délai renforcé | 30-2 | 5 motifs | `motifs_delai_renforce` |
| Assemblée au moins annuelle | 29 | — | rappel à produire |
| Convocation exigible par les copropriétaires | 29 | 1/3 des millièmes | `reglements.demande_convocation_ratio` |
| Carence du syndic | 29 | 15 jours | `reglements.carence_syndic_jours` |

Le délai renforcé s'applique dès qu'une seule résolution de l'ordre du jour
touche : la répartition des tantièmes, la classification des parties communes et
privées, la répartition des charges communes, toute modification du règlement,
ou les suites d'une destruction de l'immeuble.

**Comportement attendu** : la plateforme calcule la date limite d'envoi à partir
de l'ordre du jour et **refuse** l'envoi hors délai, plutôt que de laisser
l'assemblée devenir annulable.

### Voix

| Règle | Article | Valeur | Où |
|---|---|---|---|
| Une voix par tantième | 33-1 | — | `app.voix_assemblee()` |
| Écrêtement du majoritaire | 33-1 | au-delà de 1/2 | `reglements.ecretement_seuil_ratio` |

Au-delà de la moitié des parties communes, les voix d'un copropriétaire sont
ramenées à la somme de celles des autres. SCI ALIZE groupé pèse 3 946 tantièmes :
le plafond se déclencherait à 5 001. Non déclenché aujourd'hui, à surveiller.

### Majorités

| Code | Article | Condition | Objet |
|---|---|---|---|
| `unanimite` | 33-2 a° | unanimité des copropriétaires du syndicat | modification de la répartition des lots, classification parties communes / privées |
| `absolue` | 33-2 b° | **double** : plus de la moitié en nombre **et** 3/4 des voix présentes **et** accord de ceux dont les charges augmentent | répartition ou énonciation des charges, toute modification du règlement |
| `simple_syndicat` | 33-2 c° | majorité des voix du syndicat | suites d'une destruction |
| `ordinaire` | 33-2 d° | majorité des voix des présents ou représentés | tout le reste |

La majorité absolue est un **cumul de conditions**, pas un seuil unique. Une
résolution qui réunit 3/4 des voix présentes mais seulement 9 copropriétaires
sur 19 échoue. L'interface doit montrer chaque condition séparément, avec son
seuil chiffré.

### Quorum

Pour les décisions ordinaires (33-2 d°), l'assemblée doit réunir plus de la
moitié des tantièmes. À défaut, une seconde convocation délibère valablement
quel que soit le nombre de tantièmes présents.

### Représentation

L'article 31 laisse chacun se faire représenter par un mandataire de son choix —
tiers, parent ou autre copropriétaire — et **ne plafonne pas** le nombre de
pouvoirs détenus par un même mandataire (`plafond_pouvoirs_mandataire = null`).
Un autre règlement pourrait le faire : le paramètre existe.

Une indivision désigne un mandataire unique. Le nu-propriétaire est représenté
par l'usufruitier, sauf convention contraire notifiée au syndic.

## 5. Syndic et conseil syndical

| Règle | Article | Valeur | Où |
|---|---|---|---|
| ENIGMA AFRICA désignée syndic pour une durée illimitée, jusqu'à décision contraire de l'assemblée | 26-2 f | — | donnée d'organisation |
| Honoraires fixés par l'assemblée | 26-1 | — | poste de charges |
| Plafond de dépense engageable sans accord préalable | 26-2 a | à fixer | `reglements.plafond_depense_syndic` |
| Conseil syndical | 28 | 3 membres, 3 exercices | `conseil_syndical_membres`, `_exercices` |

Le conseil syndical vérifie les comptes, approuve les travaux au-delà du
plafond, décide de l'inscription d'hypothèque, et peut convoquer l'assemblée en
cas de carence du syndic.

## 6. Mutations

Article 19. En cas de décès, les héritiers justifient leur qualité dans les deux
mois. En cas de cession, le nouveau copropriétaire est tenu des sommes mises en
recouvrement **après** la mutation, même si elles financent des travaux
antérieurs. Tant que la mutation n'est pas justifiée au syndic, les convocations
restent valablement adressées à l'ancien propriétaire (art. 30-3).

D'où les dates sur `lot_proprietaires` : un changement de main est une nouvelle
ligne, jamais une modification de l'ancienne.

## 7. Qualité des données — contrôles à l'import

Le registre réel comporte quatre anomalies qui bloquent un envoi :

| Lot | Anomalie |
|---|---|
| 14 | aucun numéro de téléphone |
| 26 | aucune adresse électronique |
| 32 | aucun numéro de téléphone |
| 48 | adresse électronique invalide (`kaneousmane441`, sans domaine) |

Et deux adresses partagées par des personnes différentes :
`contact.partage@example.com` (Emre Yilmaz et Moussa Ba) et
`bureau.commun@example.org` (Wei Chen et Jun Zhao). Voir la règle 4 de
`CLAUDE.md`.
