# 0005 — Jouabilité : ce qu'un joueur vit heure par heure, et ce qu'on change

Date : 24 septembre 2026, veille du premier week-end de bêta fermée. Statut : mesures faites, premier
lot de correctifs livré (PR 4), décisions ouvertes en fin de page.

Le constat de Nick : « graphiquement ça fait très rétro, c'est le gameplay qui compense ». Cette page
part donc d'une question simple : **à quoi ressemble une journée d'Aurane pour quelqu'un qui vient
d'arriver, et où est le plaisir ?** Méthode : une Colonie « joueur » pilotée par le moteur de règles
(le même que le Général, donc un joueur moyen qui ne fait rien de malin) au milieu de 30 PNJ, sur
la saison de bêta de 7 jours, en relevant chaque heure ses systèmes reliés, ses stocks, son score et
le nombre d'événements qui la touchent. Puis comparaison avec les jeux qui ont réussi ce genre.

## 1. Ce que les mesures ont montré (avant correctifs)

| Heure | Systèmes reliés | Métal | Énergie | Rium | Crédits | Événements/h |
|---|---|---|---|---|---|---|
| 1 | 1 | 114 | 131 | 60 | 302 | 0 |
| 3 | 3 | 87 | 118 | 60 | 312 | 0 |
| 6 | 4 | 85 | 172 | 187 | 332 | 0 |
| 24 | 4 | 110 | 380 | 638 | 476 | 1 |
| 72 | 4 | 146 | 919 | 1 939 | 858 | 0 |
| 168 | 4 | 163 | 786 | 2 636 | 1 626 | 0 |

**Le jeu s'arrêtait à la troisième heure.** Quatre systèmes, puis plus rien pendant six jours et demi :
94 heures sur 168 sans un seul événement touchant le joueur, un rang de 18 sur 31, des stocks qui
gonflent sans emploi. Cinq causes, toutes vérifiées dans le code :

1. **Le relais devait être payé par l'avant-poste.** Un avant-poste neuf possède 4 à 11 unités de
   stock ; un relais en coûte 9 à 16. Le troisième relais et tous les suivants étaient refusés avec
   « pas assez de ressources au système d'ancrage ». Un humain aurait rencontré le même mur, sans
   comprendre qu'il devait d'abord envoyer un convoi de Métal au bout de sa ligne.
2. **Le Général vendait le Métal**, la ressource qui manque, dès 140 en stock, à 85 % du prix de base,
   parce que sa réserve par défaut était de 80. Pendant ce temps il gardait des milliers de Crédits
   qu'il ne dépensait jamais : sa règle d'achat ne se déclenchait que sous la réserve.
3. **Le Marché régional était vide.** À rayon 12 pour 31 Colonies, une seule région sur 67 a vu un
   échange en sept jours ; aucune dans la région du joueur. Le Marché, censé sauver une capitale mal
   née, n'existait pas. Une capitale à 5 d'Énergie au rayon 6 est restée à 3 systèmes toute la saison,
   1 300 Crédits en poche, sans personne à qui les donner.
4. **Le Synthétiseur de Rium se construisait à l'heure zéro** et mangeait 8 Énergie par Tirage à une
   colonie qui n'en avait pas : spirale énergétique garantie pour un Général « auto ».
5. **Le bouclier de débutant de 72 heures** couvre la moitié d'une saison de 7 jours : aucun contact
   armé avant le jeudi.

Un sixième point, structurel : le rythme économique est calibré pour 56 jours. Sur une saison de
7 jours, un joueur touche un achat significatif toutes les deux à trois heures. Sept jours ne
suffisent pas à voir la fin de sa propre courbe.

## 2. Ce que la PR 4 change (mesuré)

| Correctif | Où |
|---|---|
| Le relais est payé par l'ancrage s'il peut, sinon par la capitale : le Réseau paie | `world.buildRelay` |
| Le Général compte la capitale comme payeur quand il cherche où s'étendre | `general.expansionCandidates` |
| Réserve de Métal par défaut 160 (au lieu de 80) ; réserve de Rium 40 + 120 × agressivité, sortie autorisée dès qu'il en reste un quart | `general.reserves`, `fuelFor` |
| Un achat ne bloque plus sur une ressource qu'il ne consomme pas (bug : sous la réserve de Rium, plus rien n'était « abordable ») | `general.canAffordAt` |
| Synthétiseur : jamais avant le deuxième jour, jamais si l'Énergie manque ; et la sim l'arrête sous 60 d'Énergie | `general.decideBuildings`, `world.runDraw` |
| **Teneur de marché** : dans chaque région où quelqu'un commerce, un PNJ vend chaque ressource à 200 % du prix de référence et en achète à 40 %, 40 unités par Tirage. Un plafond et un plancher, jamais une bonne affaire : personne n'est plus jamais sans contrepartie | `world.settleMarkets`, `balance.MAKER_*` |
| **Rythme de saison** : la production est multipliée par √(56 / jours de saison), plafonné à 3 (×2,8 sur 7 jours, ×1 sur 56). Une semaine de bêta joue comme une saison | `balance.paceMultiplier` |
| **Bouclier** proportionnel à la saison : 3 h par jour de saison, 12 h au moins, 72 h au plus (21 h sur 7 jours) | `balance.shieldHours` |

Même mesure, après correctifs, rayon 6 (voir § 4 pour le rayon) :

| Heure | Systèmes reliés (Kestrel / Oriel) | Événements/h | Ce qui arrive |
|---|---|---|---|
| 1 | 3 / 2 | 1 | premiers relais dès la première demi-heure |
| 6 | 7 / 4 | 0 | Extracteur, premier échange |
| 24 | 17 / 14 | 0–1 | portée épuisée, Amplificateur |
| 48 | 17 / 14 | 0 | raids envoyés (Kestrel à 39 h), traité (Oriel) |
| 96 | 10 / 10 | 1 | **attaqué à 72 h, systèmes perdus**, tourelles, relais de secours |
| 168 | 9 / 10 | 0–2 | 10 batailles, 4 blocus, 3 ou 4 captures subies |

Heures sans événement : 95 (Kestrel) et 52 (Oriel) au lieu de 94 à 160. Premier jour dense, contact au
troisième jour, pertes réelles ensuite : c'est une saison. Le joueur-Général finit 23e sur 31 ; un humain
attentif fera mieux, et c'est le but.

Au rayon 12 avec les mêmes correctifs : 47 systèmes, 10 500 Crédits, entrepôts pleins, aucun voisin à
portée de conflit. Le rayon est un réglage de population, pas de difficulté : 31 Colonies au rayon 12
ne se rencontrent jamais.

## 3. Ce que les jeux primés du genre nous apprennent

Le genre d'Aurane existe : stratégie lente, temps réel, asynchrone, sociale. Ceux qui ont marché
partagent six principes. Note pour Aurane, après la PR 4.

| Principe | Qui l'a prouvé | Aurane |
|---|---|---|
| **Une pression constante et lisible des voisins.** Chaque étoile est disputée ; la carte se lit d'un coup d'œil ; on sait toujours qui approche | Neptune's Pride (IGF 2010) : tout est visible, la tension vient des trajets qu'on voit venir | Partiel. Le brouillard interne (0003) et les couloirs sont là ; mais au rayon 12 personne ne se touche, et l'arrivée d'une flotte ennemie n'est signalée que si le système est déjà engagé |
| **Le temps est la ressource ; on joue en cinq minutes, on revient parce que quelque chose est arrivé.** Notifications au moment utile, pas en continu | Subterfuge (Apple Design Award 2015) : parties d'une semaine, ordres à l'avance, une notification quand une promesse expire ou qu'un sous-marin arrive | Faible. Le Tirage horaire est un excellent rendez-vous mais il ne dit rien au joueur (« qu'ai-je produit ? qu'est-ce qui s'est vendu ? »). Le briefing au retour est le bon crochet, il n'existe qu'au-delà de 10 minutes d'absence |
| **La diplomatie est le vrai jeu, et la trahison a un prix public.** Promesses, traités, réputation | Subterfuge (promesses), Neptune's Pride (alliances informelles), Diplomacy | Bon sur le papier (traités, Influence, Gazette), invisible en pratique : les PNJ signent des traités sans qu'on le voie, les offres de troc n'alertent pas |
| **L'économie force l'échange.** Personne n'est autosuffisant ; le Marché est une arme | Catan (rareté et troc), Offworld Trading Company (le marché comme champ de bataille), EVE (marché seedé par des ordres PNJ au départ) | Bon design, exécution corrigée par la PR 4 : le teneur de marché joue le rôle des ordres PNJ d'EVE |
| **Programmer son empire est un plaisir en soi.** Écrire des règles, regarder agir | Screeps, Gladiabots, Factorio (automatisation) | Unique : la doctrine en langage naturel et le Général. C'est l'atout qu'aucune référence n'a. Il faut le rendre visible : montrer ce que le Général a décidé et pourquoi, pas seulement le résumé |
| **Une fin de partie qui accélère et des objectifs intermédiaires visibles.** Titres, courses, comptes à rebours | Neptune's Pride (la course aux étoiles), Subterfuge (la course aux 200 Neptunium), Catan (route la plus longue) | Les titres tournants et le Silence existent ; rien n'est visible entre le jour 2 et le jour 6. Les Phares sont hors de portée en 7 jours |

Ce que ces jeux n'ont pas, et qu'Aurane a : un Général qui écrit, une Gazette, des PNJ à personnalité,
des systèmes à plusieurs plateaux. Ce sont des raisons de revenir *lire*. La leçon des références est
qu'il faut d'abord des raisons de revenir *agir*.

## 4. Décisions pour la bêta

À trancher par Nick, dans l'ordre d'impact :

1. **Rayon 6 pour la prochaine saison** (`GALAXY_RADIUS=6`, 127 secteurs, 36 sur l'anneau de départ).
   Pour 40 Colonies, c'est la différence entre « je ne rencontre personne » et « on se dispute la même
   géante gazeuse au troisième jour ». Le rayon 12 est prévu pour 200 à 500 Colonies. Changer le rayon
   crée une nouvelle galaxie : à faire à la saison `beta-2`, pas pendant le week-end de test.
2. **Fusionner la PR 4 avant ou après le week-end ?** Elle multiplie la production par 2,8 sur la
   saison de 7 jours en cours et fait apparaître le teneur de marché. Sur une partie de test, c'est
   plutôt souhaitable : Nick verra une saison plutôt qu'un premier jour étiré.
3. **Un événement par heure pour chaque joueur** (à coder ensuite, client et serveur) :
   - le **compte rendu du Tirage** : à chaque heure, une ligne dans le journal et un signal visuel :
     bandes tirées, production reçue, ordres exécutés, prix de sa région ;
   - **alerte sur offre reçue** : troc proposé, traité proposé, invitation d'alliance, comme on alerte
     aujourd'hui une bataille ;
   - **flotte ennemie en approche** : dès qu'une flotte hostile a pour destination un de nos systèmes,
     l'annoncer avec l'heure d'arrivée. C'est la tension de Neptune's Pride, pour le prix d'un test.
4. **Un usage aux Crédits qui dorment.** Aujourd'hui les Crédits n'achètent que des ressources. Avec
   le teneur de marché, ils achètent enfin du Métal cher ; ça ne suffira pas à un joueur riche. Les
   **Décrets** du GDD (§ 8, payés en Influence) pourraient accepter les Crédits à un taux public :
   portée +10 % pendant 24 h, frais nuls trois Tirages, Garde de nuit prolongée. Annoncés dans la
   Gazette, ils font aussi de la diplomatie.
5. **Pression PNJ précoce** : des raids corsaires PNJ sur les avant-postes à partir du deuxième jour,
   annoncés, modestes, qui obligent à poser une tourelle et à comprendre le plateau avant le premier
   vrai voisin. Le tutoriel vivant du GDD, version militaire.
6. **Rendre le Général visible** : un journal « ce que j'ai fait et pourquoi » alimenté par ses notes
   (elles existent déjà : « raffinerie à X », « pas de carburant », « expansion plafonnée par
   l'Énergie »), lisible dans l'onglet Général. C'est notre Screeps, gratuit.

Les points 3, 4, 5 et 6 sont livrés par la décision 0007 (compte rendu du Tirage, alertes, Décrets en Crédits, pression
corsaire, journal du Général). Restent le point 1 (rayon 6 à la saison `beta-2`) et la refonte mobile profonde.
Après le week-end, les retours de Nick tranchent l'ordre. Les mesures de cette page se refont en une
commande (`tools/season-sim` et les scripts de rythme) à chaque changement d'équilibrage.
