# 0003 — Systèmes procéduraux à points d'intérêt, et direction artistique

Statut : proposé le 24.09.2026, à valider par Nick. Remplace la géométrie « plateau autour de
l'étoile » de la décision 0002 ; conserve ses règles de stocks locaux, de convois et de combat continu.

## 1. Le constat

Les orbites de 0002 tournent autour de l'étoile : rien à y montrer, une seule position par système,
une seule station, donc une invasion qui est un point et non un parcours. La direction artistique ne
peut pas s'accrocher à un cercle vide. Une station orbitale, un chantier, une tourelle ou un relais ne
sont crédibles qu'autour de quelque chose : une planète, une lune, une ceinture, une épave.

## 2. La décision en une phrase

Un système est une **petite carte générée** : une étoile en fond, de 2 à 7 **points d'intérêt** (POI)
reliés par des **couloirs**, un ou plusieurs **points de saut** en bordure. Tout ce qui se construit
s'accroche à un POI. Le combat continu de 0002 tourne **par POI** et sur les couloirs. Le relais n'est
plus unique : **au moins un par système, un par POI si l'on veut sécuriser**.

## 3. Les points d'intérêt

Chaque POI a un type, une taille (qui fixe ses emplacements), un rôle lisible dans son nom, et un
niveau de **couverture** (à quel point il cache ce qui s'y trouve).

| POI | Rôle | Emplacements | Couverture | Notes |
|---|---|---|---|---|
| Planète tellurique | Industrie : Extracteur, Entrepôt, Comptoir ; population | 2–4 | faible | au moins une par système habité |
| Géante gazeuse | Défense et chantiers ; ravitaillement en Énergie | 2–3 | moyenne | ses lunes sont des POI liés |
| Lune | Signal : Antenne, Amplificateur, Relais | 1–2 | faible | souvent le meilleur poste de relais de secours |
| Ceinture d'astéroïdes | Métal +50 % à l'Extracteur ; embuscades | 1–2 | forte | les flottes y sont invisibles sans Antenne à portée |
| Champ de glace / comètes | Vivres ; convois lents (+20 % de trajet) | 1 | moyenne | |
| Poche de nébuleuse | aucun bâtiment ; capteurs aveugles, portée des tirs −30 % | 0 | totale | cachette naturelle |
| Épave / ruines du Concordat ancien | fouille : Cristal, artefacts, Phares | 0–1 | moyenne | événements narratifs, factions cachées |
| Station abandonnée | capturable : relais désaffecté, emplacements existants | 1–3 | faible | raccourci pour s'installer |
| Point de saut | entrée et sortie du système | 0 | nulle | plusieurs sur les systèmes carrefour |

Les **couloirs** relient les POI (graphe connexe, quasi planaire : arbre couvrant plus une ou deux
boucles). Un trajet de couloir dure 1 à 4 minutes selon sa longueur ; les convois et les flottes le
parcourent et peuvent y être interceptés. Un système n'a **rien dans le vide** : tout ce qui existe
est à un POI ou sur un couloir.

## 4. La génération procédurale guidée

Générer à la main est impossible et générer au hasard donne des systèmes tous pareils. On génère
donc **par grammaire, sous guidance** :

1. **Entrées** : la graine du système (déterministe, rejouable), son type (normal, pulsar, Phare),
   sa ressource dominante, sa bande, sa région, sa distance au centre, et des **étiquettes de
   récit** posées sur la région par le GDD (frontière du Concordat, routes de la Guilde, cimetière de
   la Chute, sanctuaire des Oracles, refuges corsaires).
2. **Gabarits** : « Forge » (telluriques et ceintures, beaucoup d'emplacements, peu de cachettes),
   « Oasis » (une géante et ses lunes, Vivres et Énergie), « Carrefour » (deux ou trois points de saut,
   couloirs courts, station abandonnée), « Cimetière » (épaves, nébuleuse, Cristal), « Sanctuaire »
   (Phare, ruines, un seul accès), « Repaire » (ceinture et nébuleuse, deux entrées, peu de planètes),
   « Brûlé » (pulsar : Énergie, un POI, tout est exposé). Les poids des gabarits dépendent des entrées :
   une région « cimetière de la Chute » tire surtout des Cimetières, la ressource Métal favorise la Forge.
3. **Expansion** : le gabarit fixe le nombre et les types de POI ; un tirage réglé ajoute 0 à 2 POI
   « d'accident » (une épave dans une Forge, une lune de plus). Les tailles suivent la ressource
   dominante et la bande.
4. **Câblage** : positions par anneaux autour de l'étoile (ordre : telluriques dedans, géantes, puis
   ceintures et glace dehors), couloirs par arbre couvrant minimal plus boucles, points de saut sur le
   bord, à l'opposé du POI principal pour que l'invasion traverse le système.
5. **Contraintes vérifiées** (tests) : connexe ; au moins un POI qui accepte un relais ; total
   d'emplacements dans une fourchette liée au nombre d'emplacements actuel du système (0002 reste
   équilibré) ; distance minimale entre le point de saut et le POI principal ; au plus 30 % de POI à
   couverture forte ou totale hors « Repaire ».
6. **Échelle** : la génération est **paresseuse** : un système est développé à la première visite ou
   au premier claim, à partir de sa graine, et le résultat est identique quel que soit le moment.
   Une galaxie de plusieurs milliers de systèmes ne coûte rien avant d'être visitée. Les instantanés ne
   stockent que l'état mutable (propriétaires, structures, stocks), jamais la géométrie.

C'est le même principe qu'EVE (des systèmes signés, avec des sites à sonder) et que Star Citizen
(des points d'intérêt nommés autour des planètes), transposé à une échelle lisible en une minute.

## 5. Brouillard interne et exploration

- Un joueur voit un POI s'il y a une présence (structure, flotte), ou une Antenne à un couloir de
  distance, ou s'il l'a **sondé**. Les POI à couverture forte ou totale ne sont **pas listés** tant
  qu'ils ne sont pas sondés : on sait qu'un système a « quelque chose » (signature), pas quoi.
- **Sonder** est une mission d'Agent (Influence) ou l'action d'une Corvette à l'arrêt pendant deux
  minutes au point de saut. Découvrir un site donne de l'Influence et, pour une épave, un premier tirage
  de Cristal. C'est la boucle d'exploration : elle donne un but aux joueurs pacifiques et un terrain
  aux corsaires.
- Une **faction cachée** (rebelles, corsaires, « Ceux qui écoutent » du GDD) peut tenir un POI couvert
  d'un système que quelqu'un d'autre possède : elle y construit, y stationne, y lance des raids depuis
  l'intérieur. Le propriétaire ne l'apprend qu'en sondant ou en se faisant attaquer. C'est la
  dimension Rebellion demandée.

## 6. Invasion et défense

- On entre par un point de saut, on progresse de POI en POI par les couloirs. Chaque POI est un plateau
  de 0002 : tourelles, Bastion, flottes en défense, combat continu. L'attaquant choisit son chemin : la
  planète tourelle ou le détour par la lune ; le défenseur place ses tourelles en conséquence.
- **Objectifs** : couper le relais principal (le système s'assombrit si aucun autre relais ne tient),
  bloquer le POI principal (blocus et capture à 12 h comme en 0002, POI par POI), piller un Entrepôt,
  tenir un point de saut (les convois ne passent plus).
- Le combat de couloir : une flotte en transit croisée par une flotte en embuscade combat sur place,
  sans structures. Les convois non escortés y sont perdus, comme aujourd'hui.

## 7. Direction artistique

Règle StarCraft : **silhouette d'abord, couleur d'équipe ensuite, détail en dernier**. Tout objet doit
se reconnaître à 24 pixels de haut sur un téléphone.

- **Sprites 3D pré-rendus**, comme StarCraft : des modèles 3D rendus sous 16 angles en vue de trois
  quarts, éclairage et ombres cohérents, deux niveaux de détail. Rendu par un outil du dépôt
  (`tools/sprites`, three.js en Chromium sans tête, donc dans la CI, sans Blender à installer) à partir
  de modèles glTF ; en attendant des modèles sur mesure, des géométries construites en code et des kits
  CC0 (Kenney, Quaternius) retravaillés. Les planches sont publiées sur SOS et mises en cache.
- **Planètes en shader temps réel** : atmosphère, terminateur jour/nuit, anneaux, nuages qui défilent ;
  paramétrées par le type de POI et la graine. Peu coûteux, très payant, et procédural donc à l'échelle.
- **Palette** : Naboo pour le Concordat (blanc, or, courbes), BSG pour le militaire (gris, angles,
  lumières de position), Star Citizen pour les coques civiles et les cargos ; couleur d'équipe par
  faction sur les arêtes et les feux.
- **Lisibilité StarCraft** : barres de PV, portées des tourelles en arcs, sélection, ordres visibles,
  cibles marquées ; les effets ne masquent jamais l'information.
- **Preuve visuelle avant la simulation** : une planète en shader, une station, un croiseur et une
  tourelle pré-rendus, intégrés dans la scène Système actuelle. On juge sur image avant d'investir les
  paliers ci-dessous.

## 8. Plan

0. **Preuve visuelle** (client seulement) : pipeline `tools/sprites`, shader de planète, intégration
   dans la scène actuelle. Livrée avec cette page.
1. **Simulation** : POI et couloirs dans la génération (paresseuse, testée par contraintes), structures
   et relais par POI, combat et blocus par POI, embuscades de couloir, sondage et brouillard interne,
   Général qui place relais de secours et tourelles sur le chemin du point de saut. Instantanés v3 avec
   migration : les structures actuelles vont sur le POI principal, la station devient le relais du POI
   principal.
2. **Serveur** : vue Système à plusieurs POI, rapports par POI, Gazette qui nomme les lieux.
3. **Client** : carte de système (POI, couloirs, brouillard interne), plateau par POI avec les sprites
   et planètes, sondage, itinéraire d'invasion choisi au doigt.

## 9. Questions ouvertes (recommandations)

1. Nombre maximal de POI : **7**, minimum 2 (pulsars et petits systèmes).
2. Couloirs libres ou dépendants de relais internes : **libres** ; les relais ne servent qu'au Réseau
   et à la vitesse (un couloir « relayé » est parcouru 1,5 fois plus vite par ses propriétaires).
3. Part de POI cachés : **20 à 30 %** hors gabarit Repaire, pour que sonder vaille la peine sans que le
   système soit illisible.
4. Les factions cachées de PNJ : **oui dès la saison 0**, deux ou trois « Repaires » par région,
   tenus par des Généraux PNJ à doctrine corsaire, révélés par le sondage ou leurs raids.

## Résultats du palier 1 de 0003 (simulation, livré)

- **Génération** (`packages/sim/src/pois.ts`) : gabarits Forge, Oasis, Carrefour, Cimetière, Sanctuaire,
  Repaire, Brûlé pondérés par ressource, type d'étoile, région et distance au centre ; 2 à 7 points
  d'intérêt (planètes telluriques, géantes, lunes, ceintures, glaces, nébuleuses, épaves, stations
  abandonnées) placés en anneaux, 1 à 3 points de saut sur le bord à l'opposé du corps principal,
  couloirs par arbre couvrant plus une ou deux boucles, 45 s à 4 min par couloir. Génération paresseuse
  et déterministe (cache par galaxie), vérifiée par tests sur une galaxie entière : connexité, corps
  principal apte au relais et jamais couvert hors Repaire, au moins un emplacement d'industrie et un de
  défense au corps principal, 8 à 40 % de corps couverts, au moins cinq gabarits présents.
- **État** : structures et files de construction portent leur point d'intérêt ; les flottes ont un
  point d'intérêt, une liste de sauts et un saut en cours ; instantané v3 avec migration v2 → v3 (tout
  ce qui était sur le plateau unique passe au corps principal).
- **Mouvement** : arrivée d'un autre système au point de saut le plus proche du cap, traversée des
  couloirs vers la cible de l'ordre (station, installation visée ou point d'intérêt nommé
  `système:désignation`), couloirs 1,5 fois plus rapides chez soi ; un ennemi armé ou une tourelle sur le
  chemin ouvre l'engagement sur place ; les convois vont décharger au corps principal.
- **Combat par point d'intérêt** : plateaux, tourelles, bouclier du Bastion, journaux et rapports
  portent le point d'intérêt ; blocus et capture se jouent au corps principal.
- **Relais de secours** : nouvelle installation « Relais » (orbite 3, sur un autre astre apte) ; le
  système reste sur le Réseau tant qu'un relais tient. Le Général en pose un à la capitale puis dans les
  systèmes menacés ou riches, et place ses tourelles au dernier point d'intérêt avant la station sur le
  chemin du point de saut.
- **Brouillard interne et sondage** : mission d'Agent « sonder » (8 Influence, 20 min) qui révèle les
  corps couverts, +3 Influence par découverte, premier Cristal des épaves ; un système dont le corps
  principal est couvert cache son propriétaire et ses flottes aux étrangers tant qu'il n'est pas sondé.
  Les capitales corsaires préfèrent les Repaires, les autres les évitent.
- Saison accélérée de 14 jours, 40 colonies : aucune anomalie, médiane de 12 systèmes connectés,
  97 s de calcul. Reste pour les paliers suivants : vue serveur multi-corps déjà exposée (`pois`,
  `lanes`, `hop`), client à faire.
