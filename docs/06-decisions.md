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

6. **Millièmes ou dix-millièmes ?** Le règlement écrit « millièmes », le registre
   compte sur 10 000. À vérifier sur l'état descriptif de division.
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
