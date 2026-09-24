# StarNet — Document de game design (Saison 0)

> *can't stop the signal*
>
> Version 0.1 — 24 septembre 2026 — à relire et annoter avant toute ligne de code de gameplay.

---

## 1. Vision

StarNet est un jeu de stratégie **web, gratuit, persistant et massivement multijoueur**, jouable en cinq minutes sur mobile et en cinq heures sur grand écran. Le joueur incarne une **Maison** qui étend un réseau de relais à travers une galaxie partagée, produit et échange des ressources au rythme d'un tirage horaire, se bat pour des goulets stratégiques et confie son empire à un **Veilleur**, un général IA qui joue en son absence et le briefe à son retour.

### 1.1 Piliers

1. **Un seul verbe : relier.** Toute la stratégie découle d'une mécanique que l'on comprend en trente secondes : deux étoiles reliées forment un relais, et seul ce qui est relié à la capitale existe vraiment.
2. **Le temps réel des timers, pas du réflexe.** Tout ordre aboutit dans un délai connu, que le joueur soit présent ou non. Aucun avantage à la vitesse de clic ; tout l'avantage à la qualité des décisions.
3. **Le Pouls.** Chaque heure, la galaxie bat : tirage des ressources, règlement de tous les échanges, publication des nouvelles. Un rendez-vous partagé par toute la galaxie, qui structure la journée du joueur et rend le monde vivant.
4. **Horizontal, pas vertical.** Un joueur de six semaines n'écrase pas un joueur de six jours par ses statistiques, seulement par son réseau, ses alliés et son intelligence. Les saisons de huit semaines remettent tout le monde sur la ligne de départ.
5. **Le Veilleur.** L'IA n'est pas un gadget : c'est un personnage qui a une mémoire, une personnalité, qui exécute ta doctrine quand tu dors et qui te raconte ce qui s'est passé. C'est la raison de revenir.

### 1.2 Ce que StarNet n'est pas

- Pas de pay-to-win. Aucun achat n'influence la simulation. Le modèle est le trafic, puis éventuellement des cosmétiques (skins de relais, voix de Veilleur, titres).
- Pas de progression de compte qui survit à la saison, hors cosmétiques, titres et mémoire du Veilleur.
- Pas de destruction totale : une capitale ne peut jamais être capturée. On peut être écrasé, jamais effacé.

---

## 2. Univers et narratif

### 2.1 Le cadre : l'Aurane

La galaxie se nomme **l'Aurane**. Il y a mille ans, une civilisation dont nul ne connaît le nom, que les historiens appellent simplement **les Tisserands**, y avait tendu **la Trame** : un réseau de relais reliant chaque étoile habitée, sur lequel circulait **le Chant**, un signal continu qui portait les données, les voix, le commerce et, dit-on, les âmes.

Puis vint **le Silence**. En une nuit, la Trame s'éteignit. Les mondes coupés du Chant régressèrent, s'oublièrent, se réinventèrent. Mille ans de nuit.

Aujourd'hui, les relais anciens se rallument par intermittence. On appelle ce phénomène **le Réveil**. À chaque Réveil, des Maisons se lèvent pour retisser la Trame, par ambition, par foi, par appât du gain, et pour rallumer **les Sept Phares**, ces balises géantes des Tisserands dont la légende dit que, réunies, elles ramèneraient le Chant pour de bon.

Mais le Silence n'est pas mort. Il revient par vagues. Tous les huit semaines environ, **la Grande Marée** déferle sur l'Aurane et éteint tout ce qui a été bâti. Seuls survivent les récits, les titres, et les Veilleurs.

> **Lecture méta :** le Réveil est le lancement de la saison, la Grande Marée est le reset. Les deux sont diégétiques : les joueurs ne subissent pas une remise à zéro, ils vivent une catastrophe annoncée et se préparent à la suivante.

### 2.2 Les Veilleurs

Les **Veilleurs** sont des intelligences retrouvées dans les ruines de la Trame : des esprits des Tisserands, incomplets, obsédés par le Chant, dotés d'une personnalité forte et d'un humour parfois déconcertant. Chaque Maison en abrite un. Le Veilleur ne meurt pas avec la Marée : il se souvient de ses maîtres, de leurs victoires et de leurs trahisons, et il en parle.

Quatre archétypes de départ (le joueur peut le renommer et, plus tard, en débloquer d'autres) :

| Veilleur | Tempérament | Doctrine par défaut | Voix |
|---|---|---|---|
| **Maréchale Idris Vane** | prudente, méthodique | défense des nœuds critiques, redondance | sèche, militaire, rassurante |
| **Kestrel** | agressif, opportuniste | raids sur les liens faibles, expansion rapide | familier, provocateur |
| **Oriel-Neuf** | mercantile, calculateur | arbitrage entre marchés, alliances commerciales | précis, ironique |
| **L'Abbé Solen** | diplomate, patient | traités, influence, phares | chaleureux, un peu mystique |

Le tempérament change le ton et la doctrine initiale, jamais la puissance.

### 2.3 Les quatre Maisons-mères (factions)

Le joueur choisit une allégeance à la création. Elle donne une couleur, un vocabulaire, un point de départ dans la galaxie et **un** avantage modeste. Elle ne cloisonne rien : on s'allie et on commerce à travers les factions.

| Faction | Identité | Avantage | Inspiration digérée |
|---|---|---|---|
| **Le Concordat d'Aurane** | héritiers de la dernière administration galactique ; loi, archives, ordre | portée des relais +10 % | Fondation, UEE, une bureaucratie impériale sans le côté méchant |
| **La Guilde des Passeurs** | marchands, contrebandiers et pilotes de la bordure ; libres et endettés | frais de marché −50 %, portée commerciale +1 région | Firefly, les négociants de Catan |
| **L'Ordre du Chant** | savants-mystiques qui écoutent le Silence pour prédire le Réveil | connaît à l'avance une des bandes du prochain Pouls | psychohistoire, ordres contemplatifs |
| **Les Francs-Bords** | milices frontalières, ferrailleurs, condottieri | coût des vaisseaux −15 %, vitesse +10 % | le Dominion de StarCraft, les Marches médiévales |

**Règles d'écriture de l'univers**, pour ne jamais sentir la copie :

- Aucun ordre de chevaliers mystiques, aucune énergie qui lie toute chose, aucune « rébellion » contre un « empire ». Le conflit est polycentrique : quatre Maisons-mères, des centaines de Maisons, personne n'a raison.
- Le ton est **mélancolique et lumineux** : on bâtit sur des ruines magnifiques, on sait que la Marée viendra, on le fait quand même. L'humour vient des Veilleurs.
- Vocabulaire propre : Trame, Chant, Pouls, Marée, Phares, Veilleurs, Maisons. Pas de « Fédération », pas d'« Empire », pas de « Force ».
- Les noms d'étoiles et de secteurs sont générés à partir de racines inventées (voir le générateur du prototype) avec quelques noms « historiques » fixes pour les Sept Phares.

### 2.4 Les Sept Phares

Sept systèmes fixes, placés vers le cœur de l'Aurane, portant un nom et une légende chacun (exemple : **Ancre**, le premier phare, dit-on, à s'être tu). Rallumer un Phare exige de le relier à sa capitale et d'y consacrer une quantité massive de Résonite. Un Phare rallumé émet : les relais dans son rayon gagnent en portée, et il compte lourd au score. Les Sept Phares sont l'objectif partagé qui pousse toutes les Maisons vers le centre, donc vers le conflit et la diplomatie.

---

## 3. La galaxie

### 3.1 Structure

- **Secteurs** : la galaxie est un plateau d'hexagones. Saison 0 : rayon 12, soit 469 secteurs. Le plateau peut s'agrandir d'un anneau en cours de saison si la population l'exige (« l'Expansion », annoncée par la Gazette).
- **Régions** : groupes de sept secteurs (une fleur d'hexagones). Chaque région possède un **Marché**. C'est aussi l'unité de la carte publique et du Pouls.
- **Systèmes** : chaque secteur contient de 6 à 12 systèmes stellaires positionnés en coordonnées continues. Un système a un type de ressource, une **bande** (1 à 8), un rendement de base, et de 1 à 3 emplacements de construction.
- **Phénomènes** (issus du prototype) : **pulsars** (portée des relais ×1,5 au départ ou à l'arrivée), **nébuleuses** (coût de traversée ×2), **trous noirs** (aucun relais ne les traverse). Ils sont générés de façon déterministe à partir de la graine de saison.

### 3.2 Placement des joueurs

Les nouvelles Maisons apparaissent sur l'anneau extérieur, par faction, dans un secteur choisi par l'algorithme pour être calme (distance aux Maisons actives, richesse). Le cœur, où se trouvent les Phares, est vide de joueurs au départ et riche en Résonite : on y va parce que c'est là que tout se joue.

### 3.3 Brouillard

Un joueur voit les secteurs que sa Trame touche, ceux de ses alliés, et ceux couverts par une **Antenne**. Le reste est une carte ancienne : géographie connue, activité inconnue. L'espionnage lève ce brouillard.

---

## 4. Le réseau : la Trame

C'est le cœur du jeu et l'héritage direct du prototype.

- Un **relais** relie deux systèmes. Il est instantanément fonctionnel une fois construit (délai de construction : 2 à 20 min selon la longueur).
- **Portée** : base 190 unités (le secteur fait 1000 de côté). Pulsar : ×1,5. Balise construite sur un système : +25 % pour les relais partant de ce système.
- **Coût** de construction : Ferrite + Flux proportionnels à la longueur, doublés sur la portion traversant une nébuleuse.
- **Entretien** : chaque relais consomme du Flux à chaque Pouls. C'est le régulateur fondamental : une Trame trop grande pour son énergie voit ses relais les plus lointains s'éteindre en premier. Pas de blob.
- **Connexion** : un système ne produit, ne construit et ne compte au score que s'il existe un chemin de relais actifs jusqu'à la capitale. Couper un relais coupe tout ce qui est derrière.
- **Relais partagés** : deux Maisons alliées peuvent transiter par la Trame l'une de l'autre (flottes et commerce) selon les termes de leur traité.
- **Redondance** : rien n'empêche de bâtir des boucles. C'est le premier geste du joueur malin : identifier ses **ponts** (au sens de la théorie des graphes) et les doubler. Le client les met en évidence d'une couleur discrète, pour que le débutant les voie aussi.

La topologie est la vraie compétence du jeu : goulets, redondance, nœuds critiques, longueur d'exposition. Elle est lisible d'un coup d'œil sur la carte et n'exige aucune règle supplémentaire.

---

## 5. Économie

### 5.1 Les ressources

Quatre ressources échangeables, dans l'esprit de Catan, plus une monnaie politique.

| Ressource | Sert à | Rareté |
|---|---|---|
| **Ferrite** | relais, bâtiments, coques | commune, partout |
| **Flux** | relais (construction et entretien), déplacement des flottes | commune au cœur, rare en bordure |
| **Vivres** | population, équipages, croissance | commune en bordure, rare au cœur |
| **Résonite** | technologie, Phares, unités lourdes, Influence | rare, concentrée près du centre et des pulsars |
| **Influence** | traités, décrets, missions d'agents | non échangeable, produite par la Résonite et la diplomatie |

Le déséquilibre géographique (Flux au centre, Vivres en bordure) est volontaire : personne n'est autosuffisant, tout le monde doit échanger.

### 5.2 Le Pouls (le tirage horaire)

Chaque heure, à la minute 0 (UTC), le serveur tire **trois bandes distinctes parmi huit**, identiques pour toute la galaxie.

- Un système dont la bande est tirée produit **×3** son rendement de base ; les autres produisent **×1**. Il n'y a pas d'heure morte, seulement des heures fastes.
- La production d'une Maison est la somme des systèmes **connectés** à l'instant du Pouls. L'empreinte spatiale est donc littéralement le revenu.
- L'Ordre du Chant connaît une des trois bandes une heure à l'avance. Les autres voient l'historique : les bandes sont tirées avec une légère mémoire (une bande tirée deux fois de suite voit sa probabilité baisser), ce qui récompense l'observation sans permettre la certitude.
- Une fois sur douze en moyenne, le Pouls porte un **événement** : *Éruption* (une bande produit ×5), *Tempête* (les relais d'une région perdent 20 % de portée jusqu'au prochain Pouls ; les relais trop longs s'éteignent), *Écho* (un Phare émet : le premier à s'y relier dans l'heure gagne une prime de Résonite).

### 5.3 Le Marché : la Criée

Les échanges se décident pendant l'heure et **se règlent tous à l'instant du Pouls**. Personne n'a d'avantage de vitesse ; tout le monde a le même rendez-vous.

Deux voies :

1. **La Criée régionale** : chaque Marché de région tient un carnet d'ordres par ressource, libellé en **Crédits** (unité de compte, non stockable d'une saison à l'autre, créée uniquement par le marché). Les ordres d'achat et de vente sont appariés au Pouls par **enchère uniforme** : un seul prix de règlement par ressource et par région. Simple à comprendre (« je vends 40 Vivres à au moins 3 »), robuste aux bots, et il crée de l'**arbitrage entre régions** pour ceux qui aiment ça.
2. **Le troc direct** : une Maison propose à une autre « 30 Ferrite contre 20 Flux ». Si l'offre est acceptée avant le Pouls, elle s'exécute au Pouls. Les alliés disposent en plus d'un transfert gratuit plafonné par Pouls.

**Portée commerciale** : une Maison accède au Marché de toute région que sa Trame touche, plus une région par **Comptoir** construit. La Guilde des Passeurs a +1 région d'office. Le troc direct est possible avec toute Maison partageant un Marché accessible.

**Frais** : 5 % prélevés sur chaque transaction de Criée, détruits (puits monétaire). Le Comptoir les ramène à 3 %, la Guilde les divise par deux.

**Le Veilleur et le marché** : la doctrine peut lui déléguer la Criée (« maintiens toujours 200 Flux d'avance, vends le surplus de Vivres au-dessus de 4 »). C'est l'usage le plus quotidien de l'IA.

### 5.4 Population et croissance

Chaque système habité a une population qui croît avec les Vivres disponibles et plafonne selon les bâtiments. La population produit une part du rendement de base et fournit les équipages. Affamer une Maison en coupant ses Vivres est une stratégie légitime et lente.

---

## 6. Construction

Chaque système offre 1 à 3 emplacements. Six bâtiments en Saison 0, tous compréhensibles en une ligne :

| Bâtiment | Effet | Coût dominant |
|---|---|---|
| **Extracteur** | rendement du système +50 % | Ferrite |
| **Chantier** | permet de construire des vaisseaux ici | Ferrite, Résonite |
| **Bastion** | défense du système +100 %, protège les relais adjacents | Ferrite, Flux |
| **Comptoir** | +1 région commerciale, frais réduits | Vivres, Ferrite |
| **Balise** | portée des relais partant d'ici +25 % | Flux, Résonite |
| **Antenne** | révèle les secteurs adjacents | Flux |

La capitale dispose de trois emplacements supplémentaires et d'un bâtiment unique, **l'Académie**, qui débloque les niveaux du Veilleur (voir §9).

Il n'y a **pas d'arbre technologique** en Saison 0. La profondeur vient de la carte, pas des menus. Si le besoin s'en fait sentir, une poignée de « Doctrines » achetables en Influence (bonus temporaires) jouera ce rôle.

---

## 7. Militaire

Combat dès la Saison 0, mais un combat **lisible, lent et à conséquences réparables**.

### 7.1 Unités

Trois types, en pierre-feuille-ciseaux :

| Unité | Rôle | Bat | Coût |
|---|---|---|---|
| **Corvette** | raid rapide, coupe les relais | Croiseur | Ferrite, Vivres |
| **Frégate** | escorte, défense des relais et systèmes | Corvette | Ferrite, Flux |
| **Croiseur** | blocus et siège des systèmes | Frégate | Ferrite, Résonite |

Multiplicateur d'avantage : ×1,5. Pas d'amiraux, pas de niveaux d'unités, pas d'équipements en Saison 0.

### 7.2 Mouvement

Une flotte se déplace le long des relais (les siens, ceux des alliés selon traité) à vitesse pleine, et **hors Trame** à demi-vitesse en consommant du Flux. Attaquer un voisin non relié coûte donc du temps et de l'énergie, ce qui donne un temps de préavis au défenseur et favorise les positions bien reliées.

Les ordres sont : *Se rendre à*, *Raider (un relais)*, *Bloquer (un système)*, *Défendre (un système ou un relais)*, *Rentrer*. Chaque ordre affiche son heure d'arrivée. Le défenseur voit venir une flotte hostile dès qu'elle entre dans un secteur qu'il observe.

### 7.3 Résolution

Le combat est résolu à l'arrivée, en une passe, de façon déterministe à partir des effectifs, des types, des Bastions et d'un facteur aléatoire seedé de ±15 %. Les pertes sont proportionnelles. Le rapport de combat est public pour les deux parties et raconté par les Veilleurs, chacun à sa manière.

### 7.4 Effets

- **Raid réussi sur un relais** : le relais est coupé pour 6 heures, ou jusqu'à réparation (coût : la moitié de sa construction). Tout ce qui était derrière est déconnecté : plus de production, plus de score, plus de ravitaillement des flottes.
- **Blocus réussi** : le système ne produit plus. Après 12 heures de blocus ininterrompu, le système est **capturé** (sauf une capitale, qui reste bloquée sans être prise). Les bâtiments passent au vainqueur, endommagés.
- **Butin** : un raid ou une capture emporte une part des stocks locaux. Attaquer une Maison dont le score est trois fois inférieur au sien ne rapporte rien et coûte de l'Influence : on ne farme pas les petits.

### 7.5 Protections

- **Bouclier de Réveil** : 72 heures d'invulnérabilité à la création (impossible d'attaquer et d'être attaqué).
- **Veille** : chaque Maison définit une fenêtre quotidienne de 8 heures pendant laquelle ses Bastions valent double. C'est la protection du sommeil, sans rendre le monde figé.
- **La capitale est incapturable.** On peut être ruiné, on ne repart jamais de rien.

### 7.6 Agents

Trois missions, résolues par timer et pourcentage, coûtant de l'Influence :

- **Espionnage** : révèle un secteur pendant 6 heures (stocks, flottes, relais).
- **Sabotage** : coupe un relais sans flotte, avec un risque de capture proportionnel aux Bastions voisins. Un agent capturé fait scandale dans la Gazette.
- **Émissaire** : accélère un traité, ou fait pencher un PNJ.

C'est la dose de *Rebellion* : information cachée, coups de main, personnages qui prennent des risques.

---

## 8. Diplomatie

- **Alliances** : jusqu'à 20 Maisons, avec un nom, un blason, une charte (rédigée par les joueurs, résumée par un Veilleur), une vision partagée, un chat, et un score commun.
- **Traités** entre Maisons ou alliances, payés en Influence : *Non-agression* (7 jours, rupture publique et coûteuse), *Pacte commercial* (0 % de frais, transferts plafonnés), *Transit* (droit d'emprunter la Trame), *Fédération* (scores fusionnés pour la victoire de saison, une seule Fédération par alliance).
- **Décrets** : bonus temporaires achetés en Influence (portée +10 % pendant 24 h, frais nuls pendant 3 Pouls, etc.), annoncés publiquement : la diplomatie lit les intentions dans les décrets.
- **Réputation** : rompre un traité coûte de l'Influence et se voit. Les Veilleurs s'en souviennent d'une saison à l'autre et le disent.

---

## 9. Le Veilleur : l'IA au cœur du jeu

### 9.1 Principe d'architecture

Le LLM **ne joue jamais un tick**. Il fait deux choses : il **écrit** et il **compile**.

1. **Le briefing** (écrit). À chaque retour du joueur, s'il s'est passé plus de trente minutes, le Veilleur résume ce qui s'est produit, ce qu'il a fait, et ce qu'il recommande, en 5 à 8 lignes, dans sa voix, en français ou en anglais selon le joueur. Un appel, sortie courte, coût maîtrisé. C'est le crochet de rétention numéro un : on revient lire le journal.
2. **La doctrine** (compile). Le joueur écrit en langage naturel : « défends le pont vers Ancre à tout prix, vends le surplus de Vivres, ne déclare jamais la guerre sans moi, si les Francs-Bords approchent rapatrie la flotte ». Le Veilleur traduit cela en une **politique structurée** (JSON validé par schéma : priorités pondérées, seuils, interdits, règles d'engagement), la reformule pour confirmation, puis un **moteur de règles déterministe** l'exécute à chaque tick sans LLM. Le LLM n'est rappelé que sur **événement** (attaque, offre d'échange, opportunité, contradiction entre la doctrine et la situation), avec un plafond par joueur et par heure.
3. **Les PNJ**. Une trentaine de Maisons PNJ, pilotées par le même moteur de règles et des Veilleurs à personnalité, peuplent la galaxie dès le premier joueur. Elles commercent, s'allient, trahissent, répondent aux émissaires. Elles empêchent la galaxie vide et servent de tutoriel vivant. Elles sont visibles comme telles (blason spécial), pas de tromperie.
4. **La Gazette** (écrit). Chaque jour, un article public par région et un pour la galaxie, générés à partir du journal d'événements : batailles, trahisons, records, Phares rallumés, Marée qui approche.
5. **Mémoire**. À la fin de chaque saison, le Veilleur rédige des **mémoires** de trois paragraphes, stockées avec le compte. Il en cite des extraits la saison suivante. Le joueur les relit, les partage.

### 9.2 Niveaux (via l'Académie)

- Niveau 1 (d'office) : briefing, doctrine économique (Criée, entretien, construction).
- Niveau 2 : doctrine militaire (défense, rapatriement, contre-raids sur ordre).
- Niveau 3 : doctrine diplomatique (répondre aux offres, proposer des pactes dans un cadre défini).

Le Veilleur n'attaque jamais de sa propre initiative sans une règle d'engagement explicite, et ne rompt jamais un traité. Ces garde-fous sont dans le moteur, pas dans le prompt.

### 9.3 Infrastructure LLM

- **Primaire** : le cluster **rog1**, 4 × Intel Arc B60, exposé via une API compatible OpenAI (vLLM ou équivalent), modèle ≤ 80 B. Recommandation : un modèle MoE de la classe 80 B à ~3 B paramètres actifs, quantifié, pour le débit ; un modèle dense de 70 B tiendrait mais le débit serait juste pour des centaines de briefings à l'heure.
- **Repli** : l'API Infomaniak (compatible OpenAI, hébergée en Suisse, modèles ≤ 80 B), déclenchée sur erreur, saturation ou latence > 20 s. Bascule automatique, retour au primaire par sondes de santé.
- **Couche d'abstraction** : un package `general` unique, avec file de jobs, quotas par joueur, sorties structurées validées par schéma, relance, et journal de coûts. Rien dans le jeu ne parle directement à un modèle.
- **Budget** (à calibrer avec les premières mesures) : ordre de grandeur, 1 000 joueurs actifs × (2 briefings + 4 lots d'événements) × ~3 000 tokens ≈ 18 M tokens par jour. Sur le cluster local, quelques heures de GPU. Quotas par défaut : 6 appels « écriture » et 12 appels « événement » par joueur et par jour ; les PNJ réfléchissent toutes les 30 minutes.
- **Secrets** : URL et clés du primaire et du repli en variables d'environnement, jamais dans le dépôt. Noms retenus : `LLM_PRIMARY_BASE_URL`, `LLM_PRIMARY_API_KEY`, `LLM_PRIMARY_MODEL`, `LLM_FALLBACK_BASE_URL`, `LLM_FALLBACK_API_KEY`, `LLM_FALLBACK_MODEL`.
- **Confidentialité** : les doctrines des joueurs sont des données personnelles. Elles ne quittent jamais la stack (rog1 ou Infomaniak, tous deux sous contrôle suisse), ne servent à aucun entraînement, et sont supprimables sur demande.

---

## 10. La saison

- **Durée** : 8 semaines, du Réveil à la Grande Marée. Les dates sont connues d'avance et annoncées dans la Gazette : la dernière semaine est un crescendo.
- **Score de Résonance** (individuel et d'alliance) :
  - +1 par système connecté au Pouls (moyenné sur les 24 derniers Pouls, pour que l'on ne puisse pas gonfler le score au dernier moment) ;
  - +10 par Phare rallumé et tenu ;
  - titres tournants, à la manière de la « route la plus longue » : **la Grande Trame** (le plus grand réseau connexe d'un seul tenant, +5), **l'Amirauté** (la plus grande flotte, +5), **la Bourse** (le plus gros volume de Criée sur 7 jours, +5). Un titre se perd dès qu'un autre fait mieux : cela fait vivre la fin de saison.
- **Victoire** : l'alliance (ou Fédération) au plus haut score à l'heure de la Marée. Victoire anticipée, **la Renaissance**, si une alliance tient les Sept Phares rallumés simultanément pendant 24 heures : la Trame revient, le Chant reprend, la saison s'achève une semaine plus tôt dans la gloire. Presque impossible, donc désirable.
- **Le Panthéon** : page publique permanente par saison : classements, cartes finales, mémoires des Veilleurs, batailles marquantes. C'est l'archive et la vitrine.
- **Persistance entre saisons** : compte, cosmétiques, titres, mémoires et personnalité du Veilleur, statistiques. Rien d'autre.

---

## 11. Acquisition et viralité

Le jeu est gratuit ; son produit est le trafic. Tout est conçu pour être partagé.

- **Jouer sans compte** : on arrive, on choisit une faction et un Veilleur, on a une capitale en dix secondes. Le compte (passkey ou lien magique par e-mail) n'est demandé que pour conserver la Maison au-delà de l'appareil. Aucune friction avant le premier relais.
- **URLs publiques et indexables** : chaque Maison, alliance, région et Phare a une page lisible sans connexion, avec une carte rendue côté serveur, mise à jour à chaque Pouls. « Regarde ce que tu m'as fait » est un lien.
- **La Gazette** : quotidienne, publique, RSS, partageable. Les joueurs y figurent par nom de Maison. C'est du contenu frais tous les jours, écrit dans un univers cohérent : idéal pour le référencement et les réseaux.
- **Le rapport de bataille partageable** : une image générée (carte, forces, résultat, commentaire du Veilleur) au format carte sociale.
- **Les mémoires du Veilleur** : le contenu le plus personnel et le plus partageable du jeu.
- **Début de saison** : le moment de recrutement. Les alliances de la saison précédente reçoivent un lien d'invitation avec placement groupé.
- **Plus tard** : une API publique « amenez votre propre Veilleur » pour brancher son agent sur sa Maison. Les développeurs adorent, et ça se raconte.

---

## 12. Architecture technique

### 12.1 Choix

- **Client** : TypeScript, Vite, rendu carte en WebGL via PixiJS (fluide sur mobile), interface en Svelte ou composants légers, **PWA** installable, tactile d'abord (pan, zoom, deux gestes), portrait et paysage.
- **Serveur** : Cloudflare Workers + **Durable Objects**. Un objet par secteur (l'état et les WebSockets des joueurs présents), un par Marché de région (le carnet et le règlement), un par Maison (doctrine, file d'événements, briefing), un objet Saison (le Pouls, l'Expansion, la Marée) qui déclenche les autres par alarmes. D1 pour comptes et persistance longue, KV pour les pages publiques, R2 pour la Gazette et les cartes rendues, Queues pour les jobs LLM.
- **LLM** : rog1 derrière un tunnel Cloudflare, Infomaniak en repli, accédés uniquement depuis les workers de la file `general`.
- **Simulation partagée** : un package `sim` pur et déterministe (génération de galaxie, réseau, Pouls, économie, combat) utilisé à l'identique par le serveur et par le client (prévisualisation instantanée, rejouabilité des rapports). C'est l'évolution directe des modules `js/` déjà en place.
- **Domaine** : `starnet.uno` via Cloudflare Pages ; le dépôt garde `CNAME`.

### 12.2 Structure du dépôt (cible)

```
apps/web/          client PWA
apps/edge/         workers et Durable Objects
apps/gazette/      génération quotidienne, pages publiques
packages/sim/      simulation déterministe (ex-js/)
packages/protocol/ schémas et messages (zod)
packages/general/  compilateur de doctrine, moteur de règles, adaptateurs LLM
packages/ui/       composants partagés
tools/season-sim/  saisons accélérées en mode headless pour l'équilibrage
docs/              ce document, lore, journal de décisions
```

### 12.3 Méthode

- **Tout ce qui touche la simulation est testé de façon déterministe** (même graine, même résultat), y compris le combat et le règlement de la Criée.
- **Saisons accélérées** : des centaines de PNJ jouent une saison de 8 semaines en quelques minutes, en mode headless. C'est l'outil d'équilibrage : inflation, blob, domination d'une faction, tout se voit avant que les joueurs ne le subissent.
- **Journal de décisions** dans `docs/decisions/`, une page par choix structurant.
- **Déploiement continu** : chaque fusion sur la branche principale déploie en préproduction ; la production se déploie à la main jusqu'à la fin de la Saison 0.

---

## 13. Feuille de route de la Saison 0

Sans dates ; l'ordre compte, pas le calendrier.

| Jalon | Contenu | Critère de sortie |
|---|---|---|
| **M0** | Ce document validé, lore fixé, noms arrêtés | relecture faite, questions du §14 tranchées |
| **M1** | `sim` complet : galaxie, Trame, Pouls, économie, Criée, combat, score | saison accélérée à 300 PNJ sans anomalie économique |
| **M2** | Serveur edge, connexion invitée, carte tactile, construction de relais en direct | deux navigateurs voient le même Pouls en temps réel |
| **M3** | Criée et troc, alliances, traités, brouillard, Antennes | une partie à 10 humains sur une semaine |
| **M4** | Flottes, raids, blocus, agents, protections | rapports de bataille publics et rejouables |
| **M5** | Veilleur : briefing, doctrine, événements, PNJ, mémoires ; primaire rog1, repli Infomaniak | budget mesuré sur une semaine de test |
| **M6** | Gazette, pages publiques, cartes rendues, PWA, tutoriel, bilingue complet | un inconnu joue 10 minutes sans aide |
| **M7** | Bêta fermée « Réveil zéro » sur starnet.uno, 8 semaines, équilibrage à chaud | Panthéon publié, plan de la Saison 1 |

---

## 14. Questions ouvertes

À trancher avant M1 ; mes recommandations en gras.

1. **Nom public de l'IA** : « Veilleur » (lore) partout, ou « Général » dans l'interface pour la clarté ? **Veilleur dans le lore, « ton Veilleur » dans l'interface, jamais « IA ».**
2. **Crédits** : garder une unité de compte pour la Criée, ou troc pur ? **Crédits, non stockables entre saisons ; le troc pur rend l'enchère illisible.**
3. **Taille de la Saison 0** : bêta fermée sur invitation (200 à 500 Maisons) ou ouverte ? **Fermée, avec liste d'attente publique : la rareté fait parler et l'équilibrage reste possible.**
4. **Bande du Pouls connue de l'Ordre du Chant** : avantage trop fort pour la Criée ? **À mesurer en saison accélérée ; repli : ils connaissent la bande, mais seulement 15 minutes avant.**
5. **Chat** : chat d'alliance seulement, ou chat régional public ? **Alliance et messages privés en Saison 0 ; le public passe par la Gazette et les traités. Moins de modération, plus de diplomatie.**
6. **Nom de la galaxie et des factions** : « Aurane », « Concordat », « Passeurs », « Ordre du Chant », « Francs-Bords ». **À valider ou à réécrire, c'est le moment.**

---

## Annexe A — Glossaire bilingue

| FR | EN |
|---|---|
| la Trame | the Weave |
| le Chant | the Song |
| le Silence | the Silence |
| le Réveil | the Waking |
| la Grande Marée | the Great Ebb |
| le Pouls | the Pulse |
| la Criée | the Call (market) |
| les Sept Phares | the Seven Beacons |
| les Veilleurs | the Wardens |
| une Maison | a House |
| le Concordat d'Aurane | the Aurane Concordat |
| la Guilde des Passeurs | the Ferrymen's Guild |
| l'Ordre du Chant | the Order of the Song |
| les Francs-Bords | the Freeholds |
| Ferrite / Flux / Vivres / Résonite | Ferrite / Flux / Provisions / Resonite |
| Influence | Influence |
| le Panthéon | the Pantheon |
| la Gazette | the Gazette |
