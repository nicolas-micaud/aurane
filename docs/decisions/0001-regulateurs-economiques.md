# 0001 — Régulateurs économiques de la Saison 0

Date : 24 septembre 2026. Statut : adopté, à réviser après la bêta fermée.

## Contexte

Les premières saisons accélérées (`tools/season-sim`, 120 Colonies PNJ, 56 jours, rayon 8) ont
révélé trois pathologies, dans cet ordre :

1. **Spirale énergétique** : 43 % des Colonies bloquées à un système. Une capitale qui ne
   produit pas d'Énergie dépense son stock en relais, ses relais s'éteignent faute d'entretien,
   plus rien ne rentre, et le Marché ne la sauve pas parce que personne n'a d'Énergie à vendre.
2. **Plafond géométrique** : une fois l'énergie réglée, l'expansion plafonnait à 4 systèmes :
   avec 6 à 12 systèmes par secteur et 190 unités de portée, il n'y avait simplement rien à
   portée. Les Colonies accumulaient des dizaines de milliers de Métal sans pouvoir s'en servir.
3. **Blob** : une fois la portée réglée, une Colonie atteignait 159 systèmes contre une médiane
   de 14 (Gini 0,50), ce qui contredit le pilier « horizontal, pas vertical ».

## Décisions

| Levier | Valeur | Effet mesuré |
|---|---|---|
| Filet générique : chaque système connecté produit 1 de chaque ressource, la capitale 3 | `GENERIC_YIELD`, `CAPITAL_GENERIC_YIELD` | 0 Colonie bloquée, 0 affamée |
| Création de Crédits : 2 par système connecté et par Tirage, détruits par les frais | `CREDITS_PER_SYSTEM_PER_DRAW` | échanges réglés : 14 → 8 867 |
| Densité : 10 à 16 systèmes par secteur, portée de base 260 | `systemsPerSector`, `BASE_RANGE` | médiane connectée : 4 → 13 |
| Entretien superlinéaire : total × (1 + 0,03 × relais actifs) | `UPKEEP_SCALE_PER_RELAY` | max connecté : 159 → 69, Gini 0,50 → 0,36 |

## Ce que cela signifie pour le joueur

- Personne ne meurt d'asphyxie : même une capitale mal placée avance lentement.
- La spécialité fait la richesse, le filet évite la mort ; commercer reste le moyen de croître vite.
- Grandir coûte de plus en plus cher en Énergie : à partir d'une trentaine de relais, il vaut
  mieux consolider (boucles, Amplificateurs, Bastions) que s'étendre, ou s'allier.
- Le prix de l'Énergie (≈ 12 à 15 Crédits en fin de saison contre 1 pour le Métal) est le
  thermomètre de la galaxie : c'est voulu, c'est la ressource qui limite les empires.

## Ouvert

- Le max reste 5× la médiane. Deux pistes non encore essayées : rendement par système
  décroissant avec la taille du Réseau, et un instinct de coalition chez les PNJ (raider le
  détenteur du titre « Grand Réseau » quand il est à portée).
- Aucune capture de système en saison accélérée : les PNJ ne bloquent jamais, ils raident. À
  ajouter au moteur de règles avant de juger l'équilibre militaire.
- Le prix du Cristal n'apparaît pas dans les rapports : il ne s'échange pas encore, tout le
  monde en produit assez pour l'Influence et trop peu pour un Phare (2 000). À observer avec
  des joueurs humains qui coordonnent un Phare en alliance.
