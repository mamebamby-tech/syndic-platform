# Produit — périmètre et utilisateurs

## Le problème

Un cabinet de syndic gère une copropriété avec un classeur Excel. Le classeur
sait calculer les quotes-parts, mais il produit **un appel de cotisation par
lot**. Sur Mamelles Tower, cela signifie 62 documents par trimestre, dont 22
pour un seul propriétaire. Les relances se font à la main, les paiements
arrivent par des canaux disparates, et les copropriétaires — dont beaucoup
vivent à l'étranger — n'ont aucune vue sur leur situation.

## Les utilisateurs

**Le gestionnaire du cabinet.** Sur poste de travail. Il prépare le budget,
lance les appels, encaisse, relance, prépare les assemblées. Il est débordé :
chaque geste répété est un coût.

**Le copropriétaire.** Sur téléphone, souvent hors du Sénégal. Il veut savoir
combien il doit, payer en une fois, et récupérer ses reçus et procès-verbaux.
Sur Mamelles Tower, ils sont 19 pour 62 lots : c'est une copropriété
d'investisseurs multi-lots, pas de résidents.

**Le locataire.** Marginal en V1 : annonces et signalement d'incidents.

## Périmètre V1

Inclus : registre des lots et des copropriétaires ; budget par période et postes
de charges à clés paramétrables ; génération des appels de fonds consolidés par
propriétaire ; encaissement (mobile money, virement, saisie manuelle) et reçus ;
relevés et soldes ; notifications courriel et WhatsApp ; documents ; annonces ;
incidents ; assemblées générales avec convocation, quorum et majorités ;
tableau de bord de recouvrement.

Exclu de la V1 : comptabilité en partie double et états financiers normés ;
gestion locative (baux, quittances de loyer) ; appels d'offres et marchés de
travaux ; application mobile native ; facturation du SaaS aux cabinets.

## Ce qui fait la différence

Trois choses qu'un tableur ne fait pas, et que les logiciels généralistes font
mal dans ce contexte :

1. **Le relevé consolidé.** Un propriétaire multi-lots voit un solde, reçoit un
   document, paie une fois.
2. **Le règlement comme paramètre.** Délais, majorités, taux et clés viennent du
   règlement de copropriété de chaque immeuble. Aucune règle n'est figée.
3. **L'assemblée outillée.** Quorum et majorités calculés en séance, délais de
   convocation contrôlés avant envoi, écrêtement du copropriétaire majoritaire.

## Contexte de déploiement

Sénégal, puis Afrique de l'Ouest. Paiement par Wave et Orange Money, virement
bancaire y compris international. Connexions mobiles irrégulières. Interface en
français. Montants en francs CFA.
