# Charte graphique

Dérivée de l'identité d'ENIGMA AFRICA SARL, relevée sur son rapport de gestion
du 17 septembre 2026 et sur son logo.

## Couleurs

| Jeton | Valeur | Emploi |
|---|---|---|
| `marque` | `#1F8A82` | titres, filets de section, logo. Contraste 4,2:1 sur blanc — **jamais** en petit texte ni en fond de bouton |
| `action` | `#166A63` | boutons, liens, valeurs positives. Contraste 6,4:1, texte blanc autorisé dessus |
| `action-doux` | `#E6F1F0` | fonds d'état actif, bandeaux d'information |
| `action-encre` | `#10504A` | texte sur `action-doux` |
| `fond` | `#F7F5F0` | fond de page, ivoire chaud |
| `surface` | `#FFFFFF` | cartes et tableaux |
| `filet` | `#E2DFD7` | bordures |
| `encre` | `#17211E` | texte principal |
| `encre-2` | `#5C6460` | texte secondaire |
| `encre-3` | `#6E756F` | étiquettes, mentions |
| `alerte` | `#97591A` | ce qui demande un arbitrage |
| `alerte-doux` | `#FDF6E9` | fond de bandeau d'alerte |
| `impaye` | `#9B2F22` | impayés, erreurs |
| `impaye-doux` | `#F8E9E6` | fond de badge impayé |

Le teal de marque et le teal d'action sont **une même couleur à deux
luminosités**, pas deux couleurs. Le premier vient du document d'ENIGMA ; le
second est son assombrissement, nécessaire pour rester lisible.

Aucune valeur hexadécimale ne doit apparaître dans un composant. Tout passe par
`tailwind.config.ts`.

## Typographie

| | |
|---|---|
| Titres | **Newsreader** — serif, en écho au registre notarial des documents du cabinet |
| Texte et chiffres | **Public Sans** |
| Chiffres | `font-variant-numeric: tabular-nums` **partout** où des montants s'empilent |

Les colonnes de montants qui ne s'alignent pas verticalement rendent un tableau
de charges illisible. C'est non négociable.

## Formes

Coins arrondis 10 à 12 px sur les cartes, 7 à 8 px sur les contrôles. Bordures
de 1 px en `filet`. **Aucune ombre portée, aucun dégradé.** Le registre est
sobre, proche du document administratif.

## Documents produits

Les appels de cotisation, convocations et procès-verbaux doivent ressembler aux
documents du cabinet, pas à l'application : logo en tête, titre en serif,
intertitres en `marque` soulignés d'un filet, pied de page avec
`Cité Keur Damel, Villa N°17 | enigma@enigmasn.com | NINEA 010008391 2R2 |
RCCM SN.DKR.2023.B.2743`.

Ces mentions viennent de la table `organisations` : un autre cabinet a les
siennes.

## Accessibilité

Texte à 4,5:1 minimum (3:1 au-delà de 24 px). Cibles tactiles de 44 px. Boutons
et liens réels, jamais de `div` cliquable. Libellé associé à chaque champ.
