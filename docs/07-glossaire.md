# Glossaire — termes à arrêter avant toute traduction

Ce document ne contient **volontairement aucune traduction**. Il liste les
termes du domaine dont le sens doit être fixé, avec la personne qui a autorité
pour le faire, *avant* qu'un seul mot soit traduit dans `messages/en.json` ou
dans une autre langue.

Pourquoi : le vocabulaire est celui du règlement de copropriété et de la loi
sénégalaise n° 88-04 du 16 juin 1988 (voir `docs/03-regles-metier.md`). Un mot
traduit approximativement dans un écran de solde ou un courriel de relance finit
cité dans un litige. CLAUDE.md l'impose déjà en français — « n'invente pas de
synonymes » — et la traduction est exactement le moment où l'on en invente.

## Comment arrêter un terme

1. Chaque terme reçoit **une** traduction par langue, écrite dans la colonne
   « Décision ». Une traduction, pas une liste de variantes.
2. La décision est prise par le cabinet (ENIGMA AFRICA pour le pilote), avec un
   juriste pour tout terme marqué **juridique**. Elle n'est pas prise par
   l'implémentation.
3. Une fois le terme arrêté, il est employé partout : interface, documents de
   courtoisie, gabarits de notification. Aucune variante « pour la lisibilité ».
4. Un terme qui change de sens selon le contexte est **scindé** avant d'être
   traduit (voir « quote-part » et « syndic »).
5. Ajouter une entrée ici avant d'ajouter une clé de message qui l'emploie.

## Les huit termes à arrêter

| Terme | Nature | Où il apparaît | Ce qui rend la traduction délicate | Décision (en) |
|---|---|---|---|---|
| **tantièmes** | juridique | colonne « Tantièmes » (registre, relevé), base 10 000, poids en assemblée, clé de répartition `tantiemes` | Ce n'est ni un pourcentage ni une surface : c'est l'unité de poids d'un lot dans la copropriété, qui fonde à la fois la répartition des charges *et* les voix en assemblée. Le règlement écrit « millièmes » alors que la base est 10 000 (question tranchée le 19/09/2026, `docs/06-decisions.md`) : la traduction doit désigner l'unité de poids sans imposer une base de 1 000. Le mot est aussi au pluriel dans l'interface (« 10 000 tantièmes ») : la règle du pluriel doit être prévue. | *à arrêter* |
| **appel de fonds** | juridique / comptable | titre du document, écran « Appels de fonds », courriels et WhatsApp (`appel_emis`), relevé | L'interface dit « appel de fonds » ; CLAUDE.md, la charte et le vocabulaire du cabinet disent aussi « appel de cotisation » pour le même document. À unifier **d'abord en français**. Ce n'est pas une facture : il est adressé à un propriétaire, provisionnel, échu à date fixe, et son paiement n'approuve pas les comptes. Le mot choisi ne doit pas suggérer une facture ni un prêt. | *à arrêter* |
| **quote-part** | juridique | colonne « Quote-part » (registre des lots, relevé), `lot_proprietaires.quote_part`, `app.quote_part` (moteur de répartition), tests (« somme des quotes-parts = montant appelé ») | **Trois sens dans le dépôt.** (a) Le poids d'un lot dans l'immeuble, en % (tantièmes ÷ total) : colonne affichée. (b) La part de détention d'un lot par un propriétaire en indivision ou démembrement (`lot_proprietaires.quote_part`, de 0 à 1). (c) La fraction d'un poste de charges imputée à un lot par le moteur de répartition. Trois notions, un seul mot : les scinder en français, puis traduire chacune. | *à arrêter, en trois* |
| **syndic** | juridique | nom du cabinet-client (ENIGMA AFRICA « désignée syndic »), interface « côté syndic », rôle du personnel (`membres`), « carence du syndic », « honoraires du syndic » | **Trois sens.** (a) La fonction juridique désignée par l'assemblée, exercée ici par une personne morale. (b) Le cabinet qui l'exerce (`organisations`). (c) Par glissement, le *syndicat* des copropriétaires (« majorité des voix du syndicat », art. 33-2). La fonction et l'organe ne se traduisent pas comme le prestataire. À scinder : la fonction, le cabinet, et le syndicat. | *à arrêter, en trois* |
| **copropriété** | juridique | règlement de copropriété, « statut de la copropriété », « compte copropriétaire », libellé produit (`baseline` de `lib/marque.ts`) | Désigne à la fois le régime juridique, l'immeuble qui y est soumis et l'ensemble des copropriétaires. Les régimes de droit civil et de common law ne se recouvrent pas : le terme choisi doit rester fidèle au statut de la loi de 1988, pas à un régime voisin. Attention au dérivé : « copropriétaire » (personne) ≠ « propriétaire » (utilisé seul dans l'écran Appels de fonds). | *à arrêter* |
| **assemblée générale** | juridique | écran validé « Assemblée générale », convocations, procès-verbaux, décisions du RCP, questions ouvertes | Les délais de convocation, le quorum et les majorités (`types_majorite`) sont attachés à ce terme : la traduction ne doit ni les changer ni les laisser croire différents. Distinguer l'assemblée ordinaire et extraordinaire (`type_assemblee`). | *à arrêter* |
| **conseil syndical** | juridique | art. 28 du règlement (3 membres, 3 exercices), `conseil_syndical_membres`, faculté de convoquer en cas de carence | Organe de contrôle **élu par les copropriétaires**, distinct du syndic qu'il contrôle. Ne pas le traduire par un mot qui évoque un conseil d'administration ni un organe du cabinet. | *à arrêter* |
| **charges communes** | juridique / comptable | art. 15 du règlement ; total du budget (`Budget.totalChargesCommunes`) ; ventilation « dont charges générales », « dont ascenseurs » | **Français arrêté** (voir « Décisions arrêtées » ci-dessous) : c'est le terme du règlement, il **inclut** les ascenseurs. « Général » et « ascenseur » sont des catégories de suivi *à l'intérieur* des charges communes, pas des charges d'un autre rang. Pour l'anglais : le mot choisi doit couvrir les ascenseurs sans les opposer à un « général », et ne pas se limiter aux charges de fonctionnement courant. | *à arrêter* |

## Décisions arrêtées

Ce qui est tranché, avec la date, pour ne pas être rouvert à la traduction.

### Charges communes (français) — 19/09/2026

Le terme juridique est **« charges communes »** (art. 15 du règlement) et il
**inclut les ascenseurs**. Les postes de dépense portent une *catégorie de
suivi* — `general`, `ascenseur` — qui décompose les charges communes ; ce ne
sont pas deux catégories de même rang, ni l'une « commune » et l'autre non.

Dans l'interface (`Budget.*`) :

| Élément | Libellé |
|---|---|
| Total du budget | **Charges communes** |
| Sous-total `general` | dont charges générales |
| Sous-total `ascenseur` | dont ascenseurs |
| En-tête de la colonne des catégories | Catégorie de suivi |

Règles qui en découlent :

- Aucun libellé, message ou document ne doit laisser entendre que les charges
  d'ascenseur ne sont pas des charges communes : pas de « charges communes *et*
  ascenseurs », pas de « hors ascenseurs » sans le dire expressément.
- Le total affiché est le total des charges communes ; il est présenté *avant*
  ses « dont », pas après comme un « total général » qui les additionnerait.
- Une catégorie de suivi inconnue s'affiche « dont {code} » : elle reste une
  ventilation des charges communes.
- Côté code, la somme de tous les postes s'appelle `totalChargesCommunes`
  (`lib/data/budget.ts`) ; `general` et `ascenseur` restent des codes de
  catégorie de suivi, pas des noms de charges.
- Ce qui reste ouvert n'est pas le sens du terme mais la **clé de répartition
  des ascenseurs** (question ouverte n° 7, `docs/06-decisions.md`) : ce sont des
  charges communes dont la clé est contestée, pas des charges « à part ».

## Termes voisins repérés dans le dépôt

À arrêter avec les huit précédents, car ils apparaissent dans les mêmes écrans :

| Terme | Où | Remarque |
|---|---|---|
| **copropriétaire / propriétaire** | colonne « Propriétaire » (Appels de fonds), fiche « propriétaire », `proprietaires` | La table s'appelle `proprietaires` ; le règlement dit « copropriétaire ». CLAUDE.md : un copropriétaire n'est pas un client. |
| **syndicat des copropriétaires** | art. 33-2 (majorités), RCP | Le troisième sens de « syndic » ci-dessus. Terme à part entière. |
| **règlement de copropriété** (RCP) | toute la documentation, `reglements` | Source de toute règle paramétrée : son intitulé est cité dans les documents. |
| **état descriptif de division** | `docs/03-regles-metier.md` §1 | Source des tantièmes. Terme notarial. |
| **majorité absolue / simple / unanimité** | `types_majorite` | Double majorité pour l'absolue : ne pas alléger. |
| **mise en demeure, pénalité de retard** | `mises_en_demeure`, `penalites` | Une pénalité est *calculée* puis *appliquée ou remise* par décision humaine : trois états, trois mots (`calculee`, `appliquee`, `renoncee`). |
| **appel de cotisation** | vocabulaire du cabinet | Voir « appel de fonds ». |
| **ayant droit, groupe, compte consolidé** | relevé, `proprietaires.groupe_id` | Regroupement *réversible* d'entités ; le mot ne doit pas laisser croire à une fusion. |
| **nue-propriété, usufruit, indivision, pleine propriété** | registre des lots, `nature_detention` | Termes de droit des biens, à faire valider par un juriste. |
| **lot** | partout | Ne pas le confondre avec « appartement » : sur Mamelles Tower, certains lots sont des salles ou espaces polyvalents. |

## Décisions de forme à prendre avec la langue

Ce ne sont pas des termes mais elles conditionnent l'affichage :

- **Variante régionale.** La locale `en` n'est pas une région. Sans choix, les
  dates s'affichent au format américain (mois/jour/année) : un lecteur d'Afrique
  de l'Ouest ou d'Europe lira `10/01/2026` comme le 10 janvier, alors que
  l'échéance est le 1er octobre. À trancher avant la première traduction : une
  variante régionale dédiée, ou un format de date sans ambiguïté.
- **Devise.** XOF dans toutes les langues, affichée par son code ISO, sans
  conversion (`i18n/formats.ts`). Ne pas traduire le nom de la monnaie dans le
  corps des documents.
- **Mention de non-opposabilité.** Le texte de `Documents.mentions.courtoisie`
  est *juridique* : sa traduction est validée par un juriste au même titre que
  les termes ci-dessus.
- **Modèles WhatsApp.** Un modèle est pré-approuvé par Meta *par langue* : les
  termes arrêtés ici sont ceux qu'il faudra soumettre, et une correction
  ultérieure repasse par une nouvelle approbation.

## Ce qui n'est pas traduit

- Les libellés saisis par le cabinet (postes de charges, clés de répartition,
  périodes, désignations de lots) sont des **données**, pas des textes
  d'interface : ils s'affichent tels que saisis. Les traduire est une autre
  décision (colonnes de libellés par langue, ou non).
- Les documents juridiques — appel de cotisation, convocation, procès-verbal —
  restent en français, seule version opposable.
