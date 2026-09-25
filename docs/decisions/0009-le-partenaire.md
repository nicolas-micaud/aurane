# 0009 — Le Partenaire : l'IA qui prend le joueur en charge

Date : 25 septembre 2026. Nick : « on a tous envie d'être le protagoniste, mais la courbe d'apprentissage d'un
jeu complexe et intéressant est rude ; les gens peuvent abandonner la première minute. Il faut quelqu'un (IA)
qui nous prenne en charge, qui nous intéresse au jeu, qui donne de l'enjeu. […] Il faut une mémoire qui rigole
pas. […] Les gens reviendront car le jeu lui-même les connaîtra, ce sera leur univers. » Décision de design ;
le découpage technique est en fin de document.

## Le constat

- Le jeu est complexe et c'est voulu : simplifier lui ferait perdre son intérêt (0005, revue S0).
- Le premier week-end de bêta l'a montré : « on ne sait pas ce qu'on fait là », l'interface est fouillie, le
  tutoriel par objectifs ne suffit pas. Les paliers d'onboarding (PR 11) réduisent ce qui est visible, ils ne
  disent pas encore *pourquoi* on est là.
- Un joueur qui abandonne à la première minute ne verra jamais la profondeur. Un joueur pris en charge par
  quelqu'un qui connaît le jeu, et qui le connaît *lui*, revient pour ce quelqu'un autant que pour le jeu.

## Ce qu'on décide

1. **Le jeu reste complexe.** On n'enlève aucune mécanique. On ajoute quelqu'un pour la porter.
2. **Le Général devient le Partenaire.** Un seul personnage, pas deux : la voix du Général (Vane, Kestrel,
   Oriel-Neuf, Solen) est déjà celle qu'on entend en premier. Son rôle s'élargit de l'exécutant au partenaire
   permanent : il explique ce qu'on voit, propose ce qu'on peut faire, montre où, se souvient de ce qu'on a
   choisi, et donne l'enjeu (« à ce rythme le Réseau s'éteint dans trois Tirages », « Solen d'à côté a repéré
   tes relais »).
3. **Il sait, il montre, il se souvient, il ne décide pas à la place.** Quatre règles :
   - *Il sait* : il parle sur l'analyse déterministe (0008), jamais sur l'état brut ; chaque chiffre est vérifié.
   - *Il montre* : chacune de ses propositions porte une action d'interface (ouvrir un écran, surligner un
     emplacement, préremplir une commande). L'interface n'est plus le chemin obligé, elle devient la
     destination de ses phrases.
   - *Il se souvient* : une mémoire par joueur, structurée et durable, qui traverse les sessions et les saisons.
   - *Il ne décide pas* : hors doctrine, une action réelle passe par un « Fais-le » du joueur. Une décision
     humaine par heure, c'est le jeu ; si le Partenaire la prend, il n'y a plus de jeu.
4. **Un routeur par type de tâche, pas par estimation de difficulté.** Trois niveaux :

   | Niveau | Quoi | Modèle |
   |---|---|---|
   | 0 | analyse, options légales et coûts, alertes, intentions simples, rappel de la mémoire | aucun : simulation et code |
   | 1 | phraser trois cartes dans la voix, répondre court, classer une demande, résumer un épisode | classe `voice` (0008), modèle épinglé |
   | 2 | briefing hebdomadaire, plan de campagne, arbitrage diplomatique, mémoire de fin de saison | classe `narrative` |

   Le Général garde sa voix au niveau 1 en toute circonstance. Le niveau 2 n'est jamais déclenché par l'horloge,
   seulement par un événement rare ou une demande explicite. Un appel commence toujours par le niveau 0 ; le
   modèle reçoit un travail déjà mâché.
5. **La mémoire est une pièce de gameplay, pas un cache.** Quatre couches, toutes par colonie :
   - *faits* : déduits du journal et des événements, sans modèle (déjà : `factsFrom`) ;
   - *choix* : ce que le joueur a accepté, refusé, demandé (« il refuse les raids », « il veut apprendre le
     Marché ») — écrits au niveau 0 à chaque carte validée ou écartée ;
   - *épisodes* : un résumé par jour actif, écrit au niveau 1, relu au retour (« hier soir tu as tenu Rakanyx
     contre un raid corsaire ») ;
   - *saisons* : déjà prévues (0008, tâche `memoir`).
   La mémoire est la propriété du joueur : consultable, exportable, effaçable depuis le client (LPD/RGPD).
6. **Le lore suit.** Une fois quelqu'un là pour l'expliquer, le lore peut devenir plus dense : noms, factions,
   histoire des Phares, Gazette. Pas avant : le Partenaire d'abord, le lore quand il a un narrateur.

## Le premier incrément : le Conseil du Tirage

Vingt minutes avant chaque Tirage, pour les joueurs vus dans les deux dernières heures :

1. la simulation calcule les options légales et chiffrées (niveau 0, `buildOptions` existe) ;
2. le Général en retient trois et les phrase dans sa voix (niveau 1, sortie JSON contrainte : titre, phrase,
   commande prête, cible « Montre-moi ») ;
3. le client les affiche en cartes, au-dessus de la carte de la galaxie et dans l'onglet Général : « Montre-moi »
   ouvre l'écran et surligne, « Fais-le » envoie la commande, « Pas maintenant » écarte ;
4. le choix (ou le refus) entre dans la mémoire *choix* ; le compte rendu du Tirage suivant y fait écho.

Au palier 0 de l'onboarding, le Conseil remplace le coach : ses trois cartes sont « touche ton étoile »,
« relie ta voisine », « regarde ton entrepôt », dans la voix du personnage, avec le « Montre-moi » à chaque fois.
C'est la prise en charge de la première minute.

## Ce qu'on mesure

- rétention à 1 minute, à 10 minutes, J1 et J7 sur les nouvelles colonies ;
- décisions humaines par heure connectée (cartes validées + commandes directes) ;
- part des ouvertures d'app qui suivent un Conseil ou une alerte ;
- coût LLM par joueur actif et par jour, par niveau (cible : moins de 2 centimes/jour au niveau 1).

Ordre de grandeur attendu aux tarifs Scaleway : 24 Conseils et 20 messages au niveau 1 par joueur et par jour
coûtent moins d'un centime ; 300 joueurs de bêta, des dizaines d'euros par mois. Le coût n'est pas le risque.
Les risques sont la latence (un conseil à dix secondes n'est pas un partenaire : budget 3 s au niveau 1, sinon
cartes de repli en personnage) et la tentation de laisser l'IA jouer à la place du joueur (règle 3).

## Découpage

| Bloc | Contenu | Qui |
|---|---|---|
| Simulation | `counsel(w, colony, tier)` : options légales filtrées par palier d'onboarding, avec pour chacune la commande prête et la cible d'interface ; tests | session cloud |
| Général | tâche `counsel` (classe `voice`) : trois cartes en JSON contraint dans la voix, cartes de repli en personnage, écriture de la couche *choix* ; tâche `episode` (niveau 1, un résumé par jour actif) | session locale |
| Monde | job `counsel` planifié à T−20 min pour les colonies vues dans les 2 h, mis en cache jusqu'au Tirage, quota par joueur ; endpoint et message WebSocket `counsel` ; commandes `counsel_take` / `counsel_skip` ; export et effacement de la mémoire | session locale (file, mémoire) + cloud (endpoints) |
| Client | cartes du Conseil (bandeau + onglet Général), actions « Montre-moi » (route vers un écran, surlignage d'un emplacement ou d'une étoile), « Fais-le », « Pas maintenant » ; page « Ce que mon Général sait de moi » | session cloud |
| Mémoire | instance dédiée (sokkan-memory / corthexis « aurane ») pour les épisodes et les saisons, la couche *faits* et *choix* restant dans Postgres avec le monde | Nick + session locale |

## Ce qui revient à Nick

1. **Un seul personnage** : le Général *est* le Partenaire (recommandé), ou un second personnage « le Signal »
   qui parle du jeu quand le Général parle de la guerre ? Recommandation : un seul, quitte à lui donner deux
   registres ; deux voix, c'est deux fois la mémoire et la confusion pour le nouveau.
2. **L'instance mémoire** : **tranché par Nick (25.09.2026) : instance dédiée tout de suite.** Une sokkan-memory
   (corthexis) propre à Aurane, séparée de la mémoire ninabot puisqu'elle contient des données de joueurs, pour les
   couches *choix*, *épisodes* et *saisons* (recherche sémantique au retour du joueur et d'une saison à l'autre) ;
   la couche *faits* reste calculée depuis le journal. Postgres garde la copie de travail (le monde n'attend jamais
   la mémoire) ; l'instance est la mémoire longue. Export et effacement couvrent les deux.
   **Budget : 100 par mois**, modèles et mémoire compris. Au coût mesuré (§ « Ce qu'on mesure »), c'est de l'ordre de
   deux cents joueurs actifs ; les quotas par joueur et par jour se règlent pour tenir ce plafond, avec une alerte à
   80 % de la dépense mensuelle et une dégradation en personnage, jamais un silence, quand il est atteint.
3. **Le budget de latence** au niveau 1 (3 s proposé) et le fournisseur qui le tient.
4. **La première minute** : remplacer le coach par le Conseil dès le palier 0 (recommandé), ou garder les deux.

## Statut

Décidé sur le principe (Nick, 25.09.2026). Premier incrément : le Conseil du Tirage, simulation et client par la
session cloud, tâches LLM et file par la session locale (demande dans `docs/ops/REQUESTS.md`).

Livré au niveau 0 (25.09.2026, même PR) : `counsel(w, colony)` dans `packages/sim/src/counsel.ts` (douze genres de
cartes, filtrées par palier, triées par urgence, trois au plus), exposé dans la vue (`me.counsel`) ; commande
`counsel_answer` qui écrit `counsel.taken` / `counsel.skipped` dans le journal du Général (la couche mémoire lit
déjà le journal) ; cartes dans le client avec « Montre-moi », « Fais-le », « Pas maintenant » et des phrases
fixes FR/EN en attendant la voix ; au palier 0 les cartes remplacent le coach. La session locale a livré le
niveau 1 dans la PR 15 (tâche `counsel` en voix, job à T−20 min, quota, couche *choix* et *épisodes* de la mémoire,
`GET /api/counsel`, `POST /api/counsel/take|skip`, `GET|DELETE /api/memory`), fusionnée dans la PR 14 pour le
branchement : `GeneralService.counselSource` lit désormais `counsel(w, colony)` de la simulation
(`apps/world/src/counsel.ts`), les phrases fixes vivent dans `packages/sim/src/counsel-text.ts` (une source pour le
client et pour les libellés donnés au modèle), et le client affiche les cartes en voix (`title`, `line`) avec repli sur
les cartes fixes quand la couche n'a pas répondu ; « Fais-le » et « Pas maintenant » passent par les endpoints, la
commande est exécutée par le monde et le choix entre dans la mémoire.
