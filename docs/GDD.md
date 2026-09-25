# Aurane — Document de game design (Saison 0)

> *can't stop the signal*
>
> Version 0.1 — 24 septembre 2026 — à relire et annoter avant toute ligne de code de gameplay.

---

## 1. Vision

Aurane (nom de travail initial : StarNet, abandonné le 24 septembre 2026 pour cause d'homonymes) est un jeu de stratégie **web, gratuit, persistant et massivement multijoueur**, jouable en cinq minutes sur mobile et en cinq heures sur grand écran. Le joueur incarne une **Colonie** qui étend un réseau de relais à travers une galaxie partagée, produit et échange des ressources au rythme d'un tirage horaire, se bat pour des goulets stratégiques et confie son empire à un **Général**, un général IA qui joue en son absence et le briefe à son retour.

### 1.1 Piliers

1. **Un seul verbe : relier.** Le jeu porte le nom de sa galaxie : on ne joue pas *à* Aurane, on joue *dans* l'Aurane. Toute la stratégie découle d'une mécanique que l'on comprend en trente secondes : deux étoiles reliées forment un relais, et seul ce qui est relié à la capitale existe vraiment.
2. **Le temps réel des timers, pas du réflexe.** Tout ordre aboutit dans un délai connu, que le joueur soit présent ou non. Aucun avantage à la vitesse de clic ; tout l'avantage à la qualité des décisions.
3. **Le Tirage.** Chaque heure, la galaxie bat : tirage des ressources, règlement de tous les échanges, publication des nouvelles. Un rendez-vous partagé par toute la galaxie, qui structure la journée du joueur et rend le monde vivant.
4. **Horizontal, pas vertical.** Un joueur de six semaines n'écrase pas un joueur de six jours par ses statistiques, seulement par son réseau, ses alliés et son intelligence. Les saisons de huit semaines remettent tout le monde sur la ligne de départ.
5. **Le Général.** L'IA n'est pas un gadget : c'est un personnage qui a une mémoire, une personnalité, qui exécute ta doctrine quand tu dors et qui te raconte ce qui s'est passé. C'est la raison de revenir.

### 1.2 Ce que Aurane n'est pas

- Pas de pay-to-win. Aucun achat n'influence la simulation. Le modèle est le trafic, puis éventuellement des cosmétiques (skins de relais, voix de Général, titres).
- Pas de progression de compte qui survit à la saison, hors cosmétiques, titres et mémoire du Général.
- Pas de destruction totale : une capitale ne peut jamais être capturée. On peut être écrasé, jamais effacé.

---

## 2. Univers et narratif

### 2.1 Le cadre : l'Aurane

La galaxie se nomme **l'Aurane**. Il y a mille ans, une civilisation dont nul ne connaît le nom, que les historiens appellent simplement **les Anciens**, y avait tendu **le Réseau** : des relais reliant chaque étoile habitée, sur lequel circulait **le Signal**, qui portait les données, les voix, le commerce et, dit-on, les âmes.

Puis vint **le Silence**. En une nuit, le Réseau s'éteignit. Les mondes coupés du Signal régressèrent, s'oublièrent, se réinventèrent. Mille ans de nuit.

Aujourd'hui, les relais anciens se rallument par intermittence. On appelle ce phénomène **le Réveil**. À chaque Réveil, des Colonies se lèvent pour retisser le Réseau, par ambition, par foi, par appât du gain, et pour rallumer **les Sept Phares**, ces balises géantes des Anciens dont la légende dit que, réunies, elles ramèneraient le Signal pour de bon.

Mais le Silence n'est pas mort. Il revient par vagues. Toutes les huit semaines environ, le Silence déferle sur l'Aurane et éteint tout ce qui a été bâti. Seuls survivent les récits, les titres, et les Généraux.

> **Lecture méta :** le Réveil est le lancement de la saison, le Silence est le reset. Les deux sont diégétiques : les joueurs ne subissent pas une remise à zéro, ils vivent une catastrophe annoncée et se préparent à la suivante.

### 2.2 Les Généraux

Les **Généraux** sont des intelligences retrouvées dans les ruines du Réseau : des esprits des Anciens, incomplets, obsédés par le Signal, dotés d'une personnalité forte et d'un humour parfois déconcertant. Chaque Colonie en abrite un. Le Général ne meurt pas avec le Silence : il se souvient de ses maîtres, de leurs victoires et de leurs trahisons, et il en parle.

Quatre archétypes de départ (le joueur peut le renommer et, plus tard, en débloquer d'autres) :

| Général | Tempérament | Doctrine par défaut | Voix |
|---|---|---|---|
| **Maréchale Idris Vane** | prudente, méthodique | défense des nœuds critiques, redondance | sèche, militaire, rassurante |
| **Kestrel** | agressif, opportuniste | raids sur les liens faibles, expansion rapide | familier, provocateur |
| **Oriel-Neuf** | mercantile, calculateur | arbitrage entre marchés, alliances commerciales | précis, ironique |
| **L'Abbé Solen** | diplomate, patient | traités, influence, phares | chaleureux, un peu mystique |

Le tempérament change le ton et la doctrine initiale, jamais la puissance.

### 2.3 Les quatre factions (factions)

Le joueur choisit une allégeance à la création. Elle donne une couleur, un vocabulaire, un point de départ dans la galaxie et **un** avantage modeste. Elle ne cloisonne rien : on s'allie et on commerce à travers les factions.

| Faction | Identité | Avantage | Inspiration digérée |
|---|---|---|---|
| **Le Concordat d'Aurane** | héritiers de la dernière administration galactique ; loi, archives, ordre | portée des relais +10 % | Fondation, UEE, une bureaucratie impériale sans le côté méchant |
| **La Guilde des Marchands** | marchands, contrebandiers et pilotes de la bordure ; libres et endettés | frais de marché −50 %, portée commerciale +1 région | Firefly, les négociants de Catan |
| **Les Oracles** | savants-mystiques qui écoutent le Silence pour prédire le Réveil | connaît à l'avance une des bandes du prochain Tirage | psychohistoire, ordres contemplatifs |
| **Les Corsaires** | milices frontalières, ferrailleurs, condottieri | coût des vaisseaux −15 %, vitesse +10 % | le Dominion de StarCraft, les Marches médiévales |

**Règles d'écriture de l'univers**, pour ne jamais sentir la copie :

- Aucun ordre de chevaliers mystiques, aucune énergie qui lie toute chose, aucune « rébellion » contre un « empire ». Le conflit est polycentrique : quatre factions, des centaines de Colonies, personne n'a raison.
- Le ton est **mélancolique et lumineux** : on bâtit sur des ruines magnifiques, on sait que le Silence viendra, on le fait quand même. L'humour vient des Généraux.
- Vocabulaire propre : Réseau, Signal, Tirage, Silence, Phares, Généraux, Colonies. Pas de « Fédération », pas d'« Empire », pas de « Force ».
- Les noms d'étoiles et de secteurs sont générés à partir de racines inventées (voir le générateur du prototype) avec quelques noms « historiques » fixes pour les Sept Phares.

### 2.4 Direction artistique (repères)

Références de Nick, à digérer sans copier : la lisibilité tactique et les silhouettes franches de
**StarCraft** pour l'interface et les icônes ; l'élégance chromée et organique de **Naboo** pour
l'architecture des Anciens, les Phares et le Concordat ; le réalisme industriel de **Star Citizen**
pour les vaisseaux (coques lisibles, tuyères, matériaux usés) ; la gravité militaire de
**Battlestar Galactica** pour les rapports de bataille, les Bastions et la voix des Généraux en
guerre. Palette : fonds profonds, relais lumineux, une couleur par faction, jamais de néon
gratuit. La carte doit rester lisible sur un téléphone en plein soleil.

### 2.5 Les Sept Phares

Sept systèmes fixes, placés vers le cœur de l'Aurane, portant un nom et une légende chacun (exemple : **Ancre**, le premier phare, dit-on, à s'être tu). Rallumer un Phare exige de le relier à sa capitale et d'y consacrer une quantité massive de Cristal. Un Phare rallumé émet : les relais dans son rayon gagnent en portée, et il compte lourd au score. Les Sept Phares sont l'objectif partagé qui pousse toutes les Colonies vers le centre, donc vers le conflit et la diplomatie.

---

## 3. La galaxie

### 3.1 Structure

- **Secteurs** : la galaxie est un plateau d'hexagones. Saison 0 : rayon 12, soit 469 secteurs. Le plateau peut s'agrandir d'un anneau en cours de saison si la population l'exige (« l'Expansion », annoncée par la Gazette).
- **Régions** : groupes de sept secteurs (une fleur d'hexagones). Chaque région possède un **Marché**. C'est aussi l'unité de la carte publique et du Tirage.
- **Systèmes** : chaque secteur contient de 10 à 16 systèmes stellaires positionnés en coordonnées continues (environ 130 unités entre voisins). Un système a un type de ressource, une **bande** (1 à 8), un rendement de base, et de 1 à 3 emplacements de construction.
- **Phénomènes** (issus du prototype) : **pulsars** (portée des relais ×1,5 au départ ou à l'arrivée), **nébuleuses** (coût de traversée ×2), **trous noirs** (aucun relais ne les traverse). Ils sont générés de façon déterministe à partir de la graine de saison.

### 3.2 Placement des joueurs

Les nouvelles Colonies apparaissent sur l'anneau extérieur, par faction, dans un secteur choisi par l'algorithme pour être calme (distance aux Colonies actives, richesse). Le cœur, où se trouvent les Phares, est vide de joueurs au départ et riche en Cristal : on y va parce que c'est là que tout se joue.

### 3.3 Brouillard

Un joueur voit les secteurs que son Réseau touche, ceux de ses alliés, et ceux couverts par une **Antenne**. Le reste est une carte ancienne : géographie connue, activité inconnue. L'espionnage lève ce brouillard.

---

## 4. Le réseau : le Réseau

C'est le cœur du jeu et l'héritage direct du prototype.

- Un **relais** relie deux systèmes. Il est instantanément fonctionnel une fois construit (délai de construction : 2 à 20 min selon la longueur).
- **Portée** : base 260 unités (le secteur fait 1000 de côté). Pulsar : ×1,5. Amplificateur construit sur un système : +25 % pour les relais partant de ce système.
- **Coût** de construction : Métal + Énergie proportionnels à la longueur, doublés sur la portion traversant une nébuleuse.
- **Entretien** : chaque relais consomme de l'Énergie à chaque Tirage, et l'entretien total croît plus vite que le nombre de relais (+3 % par relais actif). C'est le régulateur fondamental : un Réseau trop grand pour son énergie voit ses relais les plus lointains s'éteindre en premier. Pas de blob.
- **Connexion** : un système ne produit, ne construit et ne compte au score que s'il existe un chemin de relais actifs jusqu'à la capitale. Couper un relais coupe tout ce qui est derrière.
- **Relais partagés** : deux Colonies alliées peuvent transiter par le Réseau l'une de l'autre (flottes et commerce) selon les termes de leur traité.
- **Redondance** : rien n'empêche de bâtir des boucles. C'est le premier geste du joueur malin : identifier ses **ponts** (au sens de la théorie des graphes) et les doubler. Le client les met en évidence d'une couleur discrète, pour que le débutant les voie aussi.

La topologie est la vraie compétence du jeu : goulets, redondance, nœuds critiques, longueur d'exposition. Elle est lisible d'un coup d'œil sur la carte et n'exige aucune règle supplémentaire.

---

## 5. Économie

### 5.1 Les ressources

Cinq ressources échangeables, dans l'esprit de Catan, plus une monnaie politique.

| Ressource | Sert à | Rareté |
|---|---|---|
| **Métal** | relais, bâtiments, coques | commune, partout |
| **Énergie** | relais (construction et entretien), déplacement des flottes | commune au cœur, rare en bordure |
| **Vivres** | population, équipages, croissance | commune en bordure, rare au cœur |
| **Cristal** | technologie, Phares, unités lourdes, Influence | rare, concentrée près du centre et des pulsars |
| **Rium** | carburant : départs hors Réseau, opérations des flottes en territoire étranger | aucune bande au Tirage ; miné sur les géantes gazeuses (Raffinerie) ou synthétisé contre Énergie et Vivres (voir `docs/decisions/0004-rium.md`) |
| **Influence** | traités, décrets, missions d'agents | non échangeable, produite par le Cristal et la diplomatie |

Le déséquilibre géographique (Énergie au centre, Vivres en bordure) est volontaire : personne n'est autosuffisant, tout le monde doit échanger.

### 5.2 Le Tirage (le tirage horaire)

Chaque heure, à la minute 0 (UTC), le serveur tire **trois bandes distinctes parmi huit**, identiques pour toute la galaxie.

- Un système dont la bande est tirée produit **×3** son rendement de base ; les autres produisent **×1**. Il n'y a pas d'heure morte, seulement des heures fastes. Chaque système connecté ajoute un petit filet de chacune des quatre ressources (la capitale trois fois plus) : la spécialité fait la richesse, le filet évite la mort par asphyxie.
- La production d'une Colonie est la somme des systèmes **connectés** à l'instant du Tirage. L'empreinte spatiale est donc littéralement le revenu.
- Les Oracles connaissent une des trois bandes une heure à l'avance. Les autres voient l'historique : les bandes sont tirées avec une légère mémoire (une bande tirée deux fois de suite voit sa probabilité baisser), ce qui récompense l'observation sans permettre la certitude.
- Chaque Colonie reçoit à chaque Tirage un **compte rendu** dans son Journal (décision 0007) : production par ressource, Crédits versés, systèmes reliés et dans les bandes, débordements d'entrepôt, relais éteints. C'est l'événement garanti de l'heure.
- Une fois sur douze en moyenne, le Tirage porte un **événement** : *Éruption* (une bande produit ×5), *Tempête* (les relais d'une région perdent 20 % de portée jusqu'au prochain Tirage ; les relais trop longs s'éteignent), *Écho* (un Phare émet : le premier à s'y relier dans l'heure gagne une prime de Cristal).

### 5.3 Le Marché

Les échanges se décident pendant l'heure et **se règlent tous à l'instant du Tirage**. Personne n'a d'avantage de vitesse ; tout le monde a le même rendez-vous.

Deux voies :

1. **Le Marché régional** : chaque Marché de région tient un carnet d'ordres par ressource, libellé en **Crédits** (unité de compte, non stockable d'une saison à l'autre ; chaque système connecté en crée deux par Tirage, les frais de marché les détruisent). Les ordres d'achat et de vente sont appariés au Tirage par **enchère uniforme** : un seul prix de règlement par ressource et par région. Simple à comprendre (« je vends 40 Vivres à au moins 3 »), robuste aux bots, et il crée de l'**arbitrage entre régions** pour ceux qui aiment ça.
2. **Le troc direct** : une Colonie propose à une autre « 30 Métal contre 20 Énergie ». Si l'offre est acceptée avant le Tirage, elle s'exécute au Tirage. Les alliés disposent en plus d'un transfert gratuit plafonné par Tirage.

**Portée commerciale** : une Colonie accède au Marché de toute région que son Réseau touche, plus une région par **Comptoir** construit. La Guilde des Marchands a +1 région d'office. Le troc direct est possible avec toute Colonie partageant un Marché accessible.

**Frais** : 5 % prélevés sur chaque transaction de Marché, détruits (puits monétaire). Le Comptoir les ramène à 3 %, la Guilde les divise par deux.

**Le Général et le marché** : la doctrine peut lui déléguer le Marché (« maintiens toujours 200 Énergie d'avance, vends le surplus de Vivres au-dessus de 4 »). C'est l'usage le plus quotidien de l'IA.

### 5.4 Population et croissance

Chaque système habité a une population qui croît avec les Vivres disponibles et plafonne selon les bâtiments. La population produit une part du rendement de base et fournit les équipages. Affamer une Colonie en coupant ses Vivres est une stratégie légitime et lente.

---

## 6. Construction

Chaque système offre 1 à 3 emplacements. Six bâtiments en Saison 0, tous compréhensibles en une ligne :

| Bâtiment | Effet | Coût dominant |
|---|---|---|
| **Extracteur** | rendement du système +50 % | Métal |
| **Chantier** | permet de construire des vaisseaux ici | Métal, Cristal |
| **Bastion** | défense du système +100 %, protège les relais adjacents | Métal, Énergie |
| **Comptoir** | +1 région commerciale, frais réduits | Vivres, Métal |
| **Amplificateur** | portée des relais partant d'ici +25 % | Énergie, Cristal |
| **Antenne** | révèle les secteurs adjacents | Énergie |
| **Raffinerie** | 20 Rium par Tirage, seulement en orbite d'une géante gazeuse : position à tenir | Métal, Énergie |
| **Synthétiseur** | 8 Énergie + 4 Vivres → 4 Rium par Tirage, partout, l'appoint sûr | Métal, Cristal |

La capitale dispose de trois emplacements supplémentaires et d'un bâtiment unique, **l'Académie**, qui débloque les niveaux du Général (voir §9).

Il n'y a **pas d'arbre technologique** en Saison 0. La profondeur vient de la carte, pas des menus. Si le besoin s'en fait sentir, une poignée de « Doctrines » achetables en Influence (bonus temporaires) jouera ce rôle.

---

## 7. Militaire

Combat dès la Saison 0, mais un combat **lisible, lent et à conséquences réparables**.

### 7.1 Unités

Trois types, en pierre-feuille-ciseaux :

| Unité | Rôle | Bat | Coût |
|---|---|---|---|
| **Corvette** | raid rapide, coupe les relais | Croiseur | Métal, Vivres |
| **Frégate** | escorte, défense des relais et systèmes | Corvette | Métal, Énergie |
| **Croiseur** | blocus et siège des systèmes | Frégate | Métal, Cristal |

Multiplicateur d'avantage : ×1,5. Pas d'amiraux, pas de niveaux d'unités, pas d'équipements en Saison 0.

### 7.2 Mouvement

Une flotte se déplace le long des relais (les siens, ceux des alliés selon traité) à vitesse pleine, et **hors Réseau** à demi-vitesse en consommant du Rium. Attaquer un voisin non relié coûte donc du temps et de l'énergie, ce qui donne un temps de préavis au défenseur et favorise les positions bien reliées.

Les ordres sont : *Se rendre à*, *Raider (un relais)*, *Bloquer (un système)*, *Défendre (un système ou un relais)*, *Rentrer*. Chaque ordre affiche son heure d'arrivée. Le défenseur voit venir une flotte hostile dès qu'elle entre dans un secteur qu'il observe.

### 7.3 Résolution

Le combat est résolu à l'arrivée, en une passe, de façon déterministe à partir des effectifs, des types, des Bastions et d'un facteur aléatoire seedé de ±15 %. Les pertes sont proportionnelles. Le rapport de combat est public pour les deux parties et raconté par les Généraux, chacun à sa manière.

### 7.4 Effets

- **Raid réussi sur un relais** : le relais est coupé pour 6 heures, ou jusqu'à réparation (coût : la moitié de sa construction). Tout ce qui était derrière est déconnecté : plus de production, plus de score, plus de ravitaillement des flottes.
- **Blocus réussi** : le système ne produit plus. Après 12 heures de blocus ininterrompu, le système est **capturé** (sauf une capitale, qui reste bloquée sans être prise). Les bâtiments passent au vainqueur, endommagés.
- **Butin** : un raid ou une capture emporte une part des stocks locaux. Attaquer une Colonie dont le score est trois fois inférieur au sien ne rapporte rien et coûte de l'Influence : on ne farme pas les petits.

### 7.5 Protections

- **Bouclier de débutant** : 72 heures d'invulnérabilité à la création (impossible d'attaquer et d'être attaqué).
- **Garde de nuit** : chaque Colonie définit une fenêtre quotidienne de 8 heures pendant laquelle ses Bastions valent double. C'est la protection du sommeil, sans rendre le monde figé. Le décret *Longue Garde* la porte à 12 heures pendant un jour.
- **Flotte en approche** : dès qu'un vaisseau de guerre part vers un système tenu par une autre Colonie non alliée, le propriétaire est prévenu (alerte et Journal) avec l'heure d'arrivée ; son Général le dit le premier, dans sa voix (0007).
- **Pression corsaire** : dès le deuxième jour, les Colonies PNJ Corsaires lancent au plus toutes les six heures un raid modeste (six vaisseaux au plus), annoncé, sur l'avant-poste le moins défendu d'un joueur sorti du bouclier, à quatre secteurs au plus. Le tutoriel vivant, version militaire (0007).
- **La capitale est incapturable.** On peut être ruiné, on ne repart jamais de rien.

### 7.6 Agents

Trois missions, résolues par timer et pourcentage, coûtant de l'Influence :

- **Espionnage** : révèle un secteur pendant 6 heures (stocks, flottes, relais).
- **Sabotage** : coupe un relais sans flotte, avec un risque de capture proportionnel aux Bastions voisins. Un agent capturé fait scandale dans la Gazette.
- **Émissaire** : accélère un traité, ou fait pencher un PNJ.

C'est la dose de *Rebellion* : information cachée, coups de main, personnages qui prennent des risques.

---

## 8. Diplomatie

- **Alliances** : jusqu'à 20 Colonies, avec un nom, un blason, une charte (rédigée par les joueurs, résumée par un Général), une vision partagée, un chat, et un score commun.
- **Traités** entre Colonies ou alliances, payés en Influence : *Non-agression* (7 jours, rupture publique et coûteuse), *Pacte commercial* (0 % de frais, transferts plafonnés), *Transit* (droit d'emprunter le Réseau), *Fédération* (scores fusionnés pour la victoire de saison, une seule Fédération par alliance).
- **Décrets** : bonus temporaires, publics, annoncés dans la Gazette : la diplomatie lit les intentions dans les décrets. En Saison 0 ils sont payés en **Crédits** (décision 0007, pour donner un usage aux Crédits qui dorment) : *Portée* (+10 % de portée des relais, 24 h, 120 Cr), *Franchise* (frais de Marché nuls, 3 Tirages, 60 Cr), *Longue Garde* (Garde de nuit de 12 h, 24 h, 90 Cr). Un seul de chaque à la fois. Le paiement en Influence reste possible plus tard.
- **Réputation** : rompre un traité coûte de l'Influence et se voit. Les Généraux s'en souviennent d'une saison à l'autre et le disent.

---

## 9. Le Général : l'IA au cœur du jeu

### 9.1 Principe d'architecture

Le LLM **ne joue jamais un tick**. Il fait deux choses : il **écrit** et il **compile**.

1. **Le briefing** (écrit). À chaque retour du joueur, s'il s'est passé plus de trente minutes, le Général résume ce qui s'est produit, ce qu'il a fait, et ce qu'il recommande, en 5 à 8 lignes, dans sa voix, en français ou en anglais selon le joueur. Un appel, sortie courte, coût maîtrisé. C'est le crochet de rétention numéro un : on revient lire le journal.
2. **La doctrine** (compile). Le joueur écrit en langage naturel : « défends le pont vers Ancre à tout prix, vends le surplus de Vivres, ne déclare jamais la guerre sans moi, si les Corsaires approchent rapatrie la flotte ». Le Général traduit cela en une **politique structurée** (JSON validé par schéma : priorités pondérées, seuils, interdits, règles d'engagement), la reformule pour confirmation, puis un **moteur de règles déterministe** l'exécute à chaque tick sans LLM. Le LLM n'est rappelé que sur **événement** (attaque, offre d'échange, opportunité, contradiction entre la doctrine et la situation), avec un plafond par joueur et par heure.
3. **Les PNJ**. Une trentaine de Colonies PNJ, pilotées par le même moteur de règles et des Généraux à personnalité, peuplent la galaxie dès le premier joueur. Elles commercent, s'allient, trahissent, répondent aux émissaires. Elles empêchent la galaxie vide et servent de tutoriel vivant. Elles sont visibles comme telles (blason spécial), pas de tromperie.
4. **La Gazette** (écrit). Chaque jour, un article public par région et un pour la galaxie, générés à partir du journal d'événements : batailles, trahisons, records, Phares rallumés, Silence qui approche.
5. **Mémoire**. À la fin de chaque saison, le Général rédige des **mémoires** de trois paragraphes, stockées avec le compte. Il en cite des extraits la saison suivante. Le joueur les relit, les partage.

**Conversation** (décision 0006, 25.09.2026) : l'onglet Général est un fil de discussion. Ordre, question sur les
règles ou provocation, le Général répond en personnage, en une à trois phrases, et compile les ordres au passage.
Chaque personnage a une fiche (tempérament, humour, style, interdits, spécialité) et connaît les mécaniques du jeu
par un mémento joint à chaque appel ; il voit la situation réelle de la Colonie. Sans modèle, un repli à mots-clés
répond encore dans sa voix. Il **parle le premier** quand une flotte hostile part vers un de nos systèmes (une ligne
dans sa voix, sans appel au modèle) et tient un **journal** de ses décisions (« Tourelle posée à Kessa », « Sortie
annulée : pas assez de Rium »), lisible dans l'onglet Général (décision 0007).

### 9.2 Niveaux (via l'Académie)

- Niveau 1 (d'office) : briefing, doctrine économique (Marché, entretien, construction).
- Niveau 2 : doctrine militaire (défense, rapatriement, contre-raids sur ordre).
- Niveau 3 : doctrine diplomatique (répondre aux offres, proposer des pactes dans un cadre défini).

Le Général n'attaque jamais de sa propre initiative sans une règle d'engagement explicite, et ne rompt jamais un traité. Ces garde-fous sont dans le moteur, pas dans le prompt.

### 9.3 Infrastructure LLM

- **Fournisseur** (décision Nick, 25.09.2026, tranché au banc `tools/llm-bench` le soir même) : **Scaleway Generative APIs, Paris, Mistral Small 3.2 24B** — 12 réponses sur 12, latence médiane 0,96 s et 1,16 s au 90e centile, le moins cher des candidats, JSON valide, données en UE. Infomaniak reste en repli ; rog1 n'est plus appelé. Le reste de cette section décrit l'architecture d'origine et reste valable pour un retour au cluster local.
- **Primaire (origine)** : le cluster **rog1**, 4 × Intel Arc B60, exposé via une API compatible OpenAI (vLLM ou équivalent), modèle ≤ 80 B. Recommandation : un modèle MoE de la classe 80 B à ~3 B paramètres actifs, quantifié, pour le débit ; un modèle dense de 70 B tiendrait mais le débit serait juste pour des centaines de briefings à l'heure.
- **Repli** : l'API Infomaniak (compatible OpenAI, hébergée en Suisse, modèles ≤ 80 B), déclenchée sur erreur, saturation ou latence > 20 s. Bascule automatique, retour au primaire par sondes de santé.
- **Accès à rog1** : rog1 vit dans le tailnet ninabot. Les serveurs de jeu (Exoscale) rejoignent le même tailnet avec des clés éphémères par nœud et une ACL qui n'ouvre que le port de l'API LLM ; rien n'est exposé sur Internet. Les sessions de développement dans le cloud n'y accèdent pas directement : elles passent par un **Tailscale Funnel** ou un **Cloudflare Tunnel + Access** devant le point d'entrée LLM, protégé par jeton de service, ou travaillent contre le repli Infomaniak.
- **Couche d'abstraction** : un package `general` unique, avec file de jobs, quotas par joueur, sorties structurées validées par schéma, relance, et journal de coûts. Rien dans le jeu ne parle directement à un modèle.
- **Budget** (à calibrer avec les premières mesures) : ordre de grandeur, 1 000 joueurs actifs × (2 briefings + 4 lots d'événements) × ~3 000 tokens ≈ 18 M tokens par jour. Sur le cluster local, quelques heures de GPU. Quotas par défaut : 6 appels « écriture » et 12 appels « événement » par joueur et par jour ; les PNJ réfléchissent toutes les 30 minutes.
- **Secrets** : tous dans **Vaultwarden** (source de vérité), injectés au déploiement par Terraform et, en développement, par le hook de session (voir `docs/ops/access.md`). Variables : `LLM_PRIMARY_BASE_URL`, `LLM_PRIMARY_API_KEY`, `LLM_PRIMARY_MODEL`, `LLM_FALLBACK_BASE_URL`, `LLM_FALLBACK_API_KEY`, `LLM_FALLBACK_MODEL`. Jamais dans le dépôt.
- **Confidentialité** : les doctrines des joueurs sont des données personnelles. Elles ne quittent jamais la stack (rog1 ou Infomaniak, tous deux sous contrôle suisse), ne servent à aucun entraînement, et sont supprimables sur demande.

---

## 10. La saison

- **Durée** : 8 semaines, du Réveil au Silence. Les dates sont connues d'avance et annoncées dans la Gazette : la dernière semaine est un crescendo.
- **Score** (individuel et d'alliance) :
  - +1 par système connecté au Tirage (moyenné sur les 24 derniers Tirage, pour que l'on ne puisse pas gonfler le score au dernier moment) ;
  - +10 par Phare rallumé et tenu ;
  - titres tournants, à la manière de la « route la plus longue » : **le Grand Réseau** (le plus grand réseau connexe d'un seul tenant, +5), **l'Amirauté** (la plus grande flotte, +5), **la Bourse** (le plus gros volume de Marché sur 7 jours, +5). Un titre se perd dès qu'un autre fait mieux : cela fait vivre la fin de saison.
- **Victoire** : l'alliance (ou Fédération) au plus haut score à l'heure du Silence. Victoire anticipée, **la Renaissance**, si une alliance tient les Sept Phares rallumés simultanément pendant 24 heures : le Réseau revient, le Signal reprend, la saison s'achève une semaine plus tôt dans la gloire. Presque impossible, donc désirable.
- **Le Palmarès** : page publique permanente par saison : classements, cartes finales, mémoires des Généraux, batailles marquantes. C'est l'archive et la vitrine.
- **Persistance entre saisons** : compte, cosmétiques, titres, mémoires et personnalité du Général, statistiques. Rien d'autre.

---

## 11. Acquisition et viralité

Le jeu est gratuit ; son produit est le trafic. Tout est conçu pour être partagé.

- **Jouer sans compte** : on arrive, on choisit une faction et un Général, on a une capitale en dix secondes. Le compte (passkey ou lien magique par e-mail) n'est demandé que pour conserver la Colonie au-delà de l'appareil. Aucune friction avant le premier relais.
- **URLs publiques et indexables** : chaque Colonie, alliance, région et Phare a une page lisible sans connexion, avec une carte rendue côté serveur, mise à jour à chaque Tirage. « Regarde ce que tu m'as fait » est un lien.
- **La Gazette** : quotidienne, publique, RSS, partageable. Les joueurs y figurent par nom de Colonie. C'est du contenu frais tous les jours, écrit dans un univers cohérent : idéal pour le référencement et les réseaux.
- **Le rapport de bataille partageable** : une image générée (carte, forces, résultat, commentaire du Général) au format carte sociale.
- **Les mémoires du Général** : le contenu le plus personnel et le plus partageable du jeu.
- **Début de saison** : le moment de recrutement. Les alliances de la saison précédente reçoivent un lien d'invitation avec placement groupé.
- **Plus tard** : une API publique « amenez votre propre Général » pour brancher son agent sur sa Colonie. Les développeurs adorent, et ça se raconte.

---

## 12. Architecture technique

### 12.1 Choix

- **Client** : TypeScript, Vite, rendu carte en WebGL via PixiJS (fluide sur mobile), interface en Svelte ou composants légers, **PWA** installable, tactile d'abord (pan, zoom, deux gestes), portrait et paysage.
- **Frontal : Cloudflare.** DNS, certificats, WAF, cache, protection DDoS, et hébergement du client statique (Pages) sur `starnet.uno`. Les WebSockets et l'API sont proxifiés par Cloudflare vers Exoscale. Le dépôt garde `CNAME`.
- **Calcul : Exoscale** (partenariat ISV, crédit mensuel, Terraform complet). Zone `ch-gva-2`, données en Suisse.
  - **Saison 0 : une VM + Docker Compose + tunnel Cloudflare**, le motif que ninabot déploie déjà en production (voir `docs/ops/context.md`). Instance `starnet-world1`, security group deny-all, SSH et supervision par le tailnet, entrée web par `cloudflared`. Kubernetes managé (SKS) reste la cible quand le monde devra se répartir sur plusieurs processus ; on ne l'inaugure pas en même temps que le jeu.
  - **Serveur de jeu** en TypeScript sur Node : un processus « monde » par saison, qui héberge des **acteurs en mémoire** (un par secteur, un par Marché de région, un par Colonie, un pour la Saison), ordonnancés par un tick à la seconde et un planificateur d'alarmes. C'est le modèle des Durable Objects, en un processus que l'on possède. Quand la population l'exige, les secteurs se répartissent sur plusieurs processus par régions, coordonnés via NATS.
  - **PostgreSQL** pour la persistance (instantanés d'acteurs, journal d'événements, comptes, marchés réglés) et **Valkey** pour les sessions, les files courtes et le pub/sub des WebSockets : dans le Compose en préproduction, en DBaaS Exoscale (`termination_protection`) au passage en bêta. **SOS** (S3) pour la Gazette, les cartes rendues et les sauvegardes.
  - **Travailleurs** séparés dans le même Compose : file `general` (LLM), rendu des cartes publiques, Gazette quotidienne.
- **Réseau privé** : la VM rejoint le **tailnet** ninabot avec un tag dédié `tag:starnet` dont le seul grant est `rog1:8007` ; rog1, Vaultwarden et l'observabilité sont joints par là, jamais par Internet public.
- **Secrets** : Vaultwarden est la source de vérité (dossier, puis collection, `starnet`) ; chargés dans l'environnement au déploiement, jamais dans les `.tf`, les tfvars ni les images.
- **LLM** : llama.cpp sur rog1 sert le 80B à ~36 tok/s pour ~2 requêtes simultanées. Le package `general` travaille donc en **file de jobs** à concurrence 2 vers le primaire, avec repli Infomaniak (`Nemotron-3-Nano-30B-A3B` pour le profil MoE proche, ou `Apertus-70B` pour le souverain dense). JSON demandé dans le prompt et nettoyé en sortie, `reasoning_effort` coupé sur le repli : pas de dépendance à `response_format`.
- **Simulation partagée** : un package `sim` pur et déterministe (génération de galaxie, réseau, Tirage, économie, combat) utilisé à l'identique par le serveur et par le client (prévisualisation instantanée, rejouabilité des rapports). C'est l'évolution directe des modules `js/` déjà en place.
- **Observabilité** : la pile ninabot existante (Prometheus, Grafana, Loki, Uptime Kuma sur gmk1) : endpoint `/metrics` scrapé par le tailnet, logs par Promtail, alertes Grafana provisionnées par fichier avec un label `area=starnet` et sa route Telegram. Pas de tracing OTLP en Saison 0.
- **CI** : GitHub Actions tant que le dépôt vit sur GitHub (lint, typecheck, tests, saison accélérée courte) ; la migration vers la forge Forgejo de ninabot avec GitHub en miroir est une décision de Nick, pas du projet.
- **Outillage** : npm workspaces (Node 22, npm 10, ce qui tourne sur les runners), TypeScript strict, ESLint, Vitest. Pas de pnpm.

### 12.2 Structure du dépôt (cible)

```
apps/web/          client PWA (Cloudflare Pages)
apps/world/        serveur de jeu : acteurs, tick, WebSockets, API
apps/workers/      file general (LLM), rendu de cartes, Gazette
packages/sim/      simulation déterministe (ex-js/)
packages/protocol/ schémas et messages (zod)
packages/general/  compilateur de doctrine, moteur de règles, adaptateurs LLM
packages/ui/       composants partagés
tools/season-sim/  saisons accélérées en mode headless pour l'équilibrage
infra/             Terraform Exoscale (VM, privnet, SG, SOS ; DBaaS à la bêta) et Cloudflare (DNS, Pages, tunnel)
deploy/            docker-compose.yml de production, promote.sh (motif ninabot)
docs/              ce document, lore, ops, journal de décisions
```

### 12.3 Méthode

- **Tout ce qui touche la simulation est testé de façon déterministe** (même graine, même résultat), y compris le combat et le règlement du Marché.
- **Saisons accélérées** : des centaines de PNJ jouent une saison de 8 semaines en quelques minutes, en mode headless. C'est l'outil d'équilibrage : inflation, blob, domination d'une faction, tout se voit avant que les joueurs ne le subissent.
- **Journal de décisions** dans `docs/decisions/`, une page par choix structurant.
- **Déploiement** : motif ninabot : images taguées `<sha>`, stack de préproduction déployée à chaque push, **promotion manuelle** vers la production (`deploy/promote.sh`), rollback au tag précédent.

---

## 13. Feuille de route de la Saison 0

Sans dates ; l'ordre compte, pas le calendrier.

| Jalon | Contenu | Critère de sortie |
|---|---|---|
| **M0** | Ce document validé, lore fixé, noms arrêtés | relecture faite, questions du §14 tranchées |
| **M1** | `sim` complet : galaxie, Réseau, Tirage, économie, Marché, combat, score | saison accélérée à 300 PNJ sans anomalie économique |
| **M2** | Serveur edge, connexion invitée, carte tactile, construction de relais en direct | deux navigateurs voient le même Tirage en temps réel |
| **M3** | Marché et troc, alliances, traités, brouillard, Antennes | une partie à 10 humains sur une semaine |
| **M4** | Flottes, raids, blocus, agents, protections | rapports de bataille publics et rejouables |
| **M5** | Général : briefing, doctrine, événements, PNJ, mémoires ; primaire rog1, repli Infomaniak | budget mesuré sur une semaine de test |
| **M6** | Gazette, pages publiques, cartes rendues, PWA, tutoriel, bilingue complet | un inconnu joue 10 minutes sans aide |
| **M7** | Bêta fermée « Réveil zéro » sur playaurane.com, 8 semaines, équilibrage à chaud | Palmarès publié, plan de la Saison 1 |

---

## 14. Questions ouvertes

À trancher avant M1 ; mes recommandations en gras.

1. **Crédits** : garder une unité de compte pour le Marché, ou troc pur ? **Crédits, non stockables entre saisons ; le troc pur rend l'enchère illisible.**
2. **Taille de la Saison 0** : bêta fermée sur invitation (200 à 500 Colonies) ou ouverte ? **Fermée, avec liste d'attente publique : la rareté fait parler et l'équilibrage reste possible.**
3. **Bande du Tirage connue des Oracles** : avantage trop fort pour le Marché ? **À mesurer en saison accélérée ; repli : ils connaissent la bande, mais seulement 15 minutes avant.**
4. **Chat** : chat d'alliance seulement, ou chat régional public ? **Alliance et messages privés en Saison 0 ; le public passe par la Gazette et les traités. Moins de modération, plus de diplomatie.**
5. **Noms** : « Aurane », « Concordat », « Guilde des Marchands », « Oracles », « Corsaires » ; ressources Métal / Énergie / Vivres / Cristal ; « Tirage », « Marché », « Silence », « Général », « Colonie ». **Validés sauf avis contraire.**
6. **Kubernetes ou VM simple** sur Exoscale ? **Tranché d'après le contexte ninabot : VM + Compose + tunnel pour la Saison 0 (motif éprouvé, dans la marge du crédit ISV) ; SKS quand le monde devra se répartir. Le budget DBaaS (≈ 150–250 CHF/mois au-delà du crédit) se valide avant le passage en bêta.**

---

## Annexe A — Glossaire bilingue

| FR | EN | Rôle |
|---|---|---|
| l'Aurane | the Aurane | la galaxie |
| les Anciens | the Ancients | les bâtisseurs disparus |
| le Réseau | the Network | les relais du joueur (Aurane) |
| le Signal | the Signal | ce qui circule sur le Réseau |
| le Réveil | the Waking | début de saison |
| le Silence | the Silence | fin de saison, reset |
| le Tirage | the Draw | tirage horaire des ressources |
| le Marché | the Market | échanges, réglés au Tirage |
| les Sept Phares | the Seven Beacons | objectifs partagés au centre |
| le Général | the General | l'IA du joueur |
| une Colonie | a Colony | un joueur |
| le Concordat d'Aurane | the Aurane Concordat | faction : portée |
| la Guilde des Marchands | the Merchants' Guild | faction : commerce |
| les Oracles | the Oracles | faction : prédiction du Tirage |
| les Corsaires | the Corsairs | faction : militaire |
| Métal / Énergie / Vivres / Cristal | Metal / Energy / Food / Crystal | ressources |
| Influence | Influence | monnaie politique |
| le Palmarès | the Hall of Fame | archive des saisons |
| la Gazette | the Gazette | journal quotidien |
