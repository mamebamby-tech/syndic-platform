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

Quatre contacts inexploitables (lots 14, 26, 32, 48) et deux adresses
électroniques partagées par des personnes différentes. Détail dans
`docs/03-regles-metier.md`, section 7. À corriger dans le registre source avant
toute mise en service, pas dans la base.

## Chantiers différés

| Chantier | Pourquoi plus tard | Ce qui le déclenche |
|---|---|---|
| Écran « Nouvel immeuble » | Tant qu'il n'y a qu'un immeuble, la saisie du règlement et l'import du registre se font en SQL. | Le deuxième immeuble confié au cabinet. |
| Page d'accueil publique | Les utilisateurs du pilote reçoivent un lien direct vers leur espace ; une vitrine ne leur sert à rien. | Le démarchage d'un cabinet tiers — et le choix du nom, dont elle dépend entièrement. |
| Dépôt du règlement en PDF avec extraction des paramètres | Demande du travail et ne dispense jamais d'une validation humaine : une erreur de lecture se paierait en assemblée. | Le troisième immeuble, quand la saisie manuelle devient répétitive. Facturé comme prestation de démarrage, pas offert : c'est du conseil juridique outillé. |

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
