# 0002 — Deux échelles : la Galaxie et le Système

Date : 24 septembre 2026. Statut : **validé par Nick sur les deux principes** (stocks par système +
convois ; combat continu). Cette page fixe les règles et les chiffres avant que la simulation ne
change. Elle complète le GDD ; en cas de contradiction, elle l'emporte sur les §4 à §7 du GDD.

---

## 1. Ce qui change, en une phrase

Aurane devient un jeu à deux échelles : **la Galaxie** (où l'on décide) et **le Système** (où l'on
construit, où l'on achemine et où l'on se bat). Le Réseau reste le système nerveux ; les **convois**
deviennent le système sanguin ; le combat devient **continu** et visible.

Les piliers du GDD ne bougent pas : un seul verbe pour commencer (relier), temps réel des timers,
Tirage horaire, horizontal plutôt que vertical, le Général.

## 2. Le Système : géométrie et emplacements

Chaque système est un plateau circulaire autour de son étoile.

- **Trois orbites** : basse (rayon 1), moyenne (2), haute (3). Unité : le *cran* ; le plateau fait
  4 crans de rayon, l'entrée des flottes se fait sur le bord (cran 4), à l'angle d'où elles viennent.
- **Emplacements** : les `slots` actuels (1 à 3, +3 pour la capitale) deviennent des **emplacements
  orbitaux** répartis sur les orbites : orbite basse pour l'industrie (extracteur, entrepôt), moyenne
  pour le militaire (chantier, tourelles, Bastion), haute pour le Signal (station-relais, antenne,
  amplificateur). Le joueur choisit l'emplacement dans la limite de l'orbite ; ce choix compte pour la
  défense (une tourelle en haute couvre l'entrée, une en basse couvre l'entrepôt).
- **La station-relais** est le nœud physique du Réseau : c'est *elle* qui porte les relais du
  système. Elle existe automatiquement sur tout système réclamé (0 emplacement, gratuite, 300 PV).
  La détruire coupe tous les relais du système jusqu'à sa reconstruction (le « relais coupé 6 h »
  actuel devient : station à 0 PV, réparation automatique en 6 h si le système est connecté, sinon
  jusqu'à intervention).

## 3. Stocks locaux et logistique

### 3.1 Où sont les ressources

- **Chaque système a un stock** (Métal, Énergie, Vivres, Cristal) et une **capacité d'entrepôt** :
  600 par ressource de base, +900 par Entrepôt construit, capitale ×3. Au-delà, la production est
  perdue (le joueur le voit : jauge pleine en rouge). Les Crédits et l'Influence restent globaux.
- **Production** : au Tirage, un système produit *chez lui*. Le filet générique (1 de chaque, 3 à la
  capitale) et la spécialité s'y déposent.
- **Consommation locale** : construire, entraîner, réparer et entretenir consomment **le stock du
  système concerné**. L'entretien des relais est payé par la station-relais de chaque extrémité
  (moitié chacune) ; une station sans Énergie éteint ses relais (la règle actuelle, localisée).
- **Le Marché** livre et prélève dans un système désigné : par défaut la capitale, ou tout système
  disposant d'un **Comptoir** dans la région du Marché. Les ordres se placent depuis ce système et les
  marchandises y arrivent au Tirage.

### 3.2 Les cargos et les convois

- **Cargo** : nouvelle unité civile. Soute 120, vitesse 45 unités/min sur le Réseau (les militaires :
  60), 0 en combat (1 PV symbolique : un cargo intercepté est perdu avec sa cargaison). Coût : 25
  Métal, 10 Vivres, 240 s au Chantier ; la capitale en reçoit **2 à la fondation**.
- **Convoi** : un groupe de cargos (et d'escortes militaires optionnelles) qui part d'un système, suit
  le Réseau (ou l'espace libre à demi-vitesse, comme les flottes), et décharge à l'arrivée. Le convoi
  se déplace à la vitesse du plus lent.
- **Route de ravitaillement** : une règle persistante « depuis A vers B : jusqu'à N de X par voyage,
  quand B en a moins de S ». Le Général assigne automatiquement des cargos disponibles à A. Une Colonie
  peut avoir 3 routes actives au départ, +2 par Comptoir. Les routes sont visibles sur la carte comme
  des filets pointillés le long des relais.
- **Route automatique de départ** : à la fondation, une route « tout excédent vers la capitale » est
  créée pour chaque nouveau système réclamé (désactivable). Le débutant n'a rien à comprendre pour
  que ses ressources reviennent chez lui ; le joueur avancé la remplace.
- **Interception** : une flotte hostile en **Défense** ou en **Blocus** sur un système attaque tout
  convoi qui y transite ou y arrive ; une flotte en **Embuscade** (nouvel ordre) sur un relais attaque
  les convois qui l'empruntent. Un cargo sans escorte est perdu à la première salve ; une escorte
  combat normalement. C'est la guerre logistique : on coupe un ravitaillement en tenant un nœud.
- **Transfert allié** : le plafond de 200 par Tirage disparaît ; les alliés s'envoient des convois
  comme tout le monde. Le troc et le Marché restent réglés au Tirage, mais **la livraison physique
  se fait par convoi** entre les systèmes désignés des deux parties (un convoi neutre, automatique,
  escortable, interceptable, qui met le temps du trajet). Deux voisins échangent en dix minutes ;
  deux Colonies à l'autre bout de la galaxie doivent passer par des intermédiaires ou des Comptoirs.

### 3.3 Ce que le joueur voit

- Dans la vue Système : les jauges de l'entrepôt, les cargos à quai, les convois en approche avec
  leur heure d'arrivée et leur cargaison, les routes qui partent d'ici.
- Sur la carte : les convois comme de petits trains de points le long des relais ; un convoi
  menacé clignote ; une route dont l'origine est vide s'affiche en gris.

## 4. Le combat continu

### 4.1 Modèle

Tout ce qui combat a des **PV**, une **portée**, des **dégâts par seconde** et une **cible**. La
résolution se fait à chaque tick serveur (1 s) pour les systèmes où des hostiles sont présents ; les
autres ne coûtent rien. Le client interpole entre deux états (2 envois par seconde quand on regarde
un combat, 1 toutes les 10 s sinon).

| Unité | PV | DPS | Portée (crans) | Vitesse (crans/min) | Rôle |
|---|---|---|---|---|---|
| Corvette | 40 | 0,6 | 0,6 | 30 | rapide, ×1,5 sur croiseurs, cible en priorité les stations et cargos |
| Frégate | 90 | 0,8 | 1,0 | 18 | escorte, ×1,5 sur corvettes, intercepte ce qui approche de sa protégée |
| Croiseur | 220 | 1,8 | 1,6 | 12 | siège, ×1,5 sur frégates, cible en priorité tourelles et Bastion |
| Cargo | 1 | 0 | — | 15 (45 sur Réseau) | fuit vers le dock |

> Calibrage palier 1 : DPS divisés par dix et vitesses de manœuvre multipliées par cinq par rapport
> au premier jet, pour qu'un engagement dure des minutes (le joueur présent peut replier ou refocaliser)
> et qu'une flotte rapide ne meure pas pendant son approche. La station est au **centre** du plateau,
> les orbites 1 à 3 l'entourent, le bord est à 4 crans ; les portées des tourelles sont mesurées depuis
> l'orbite 2, d'où des valeurs plus grandes qu'annoncé.

| Installation | PV | DPS | Portée | Coût | Notes |
|---|---|---|---|---|---|
| Station-relais | 300 | 0 | — | gratuite | régénère 0,5 PV/s hors combat |
| Tourelle légère | 150 | 1,0 | 2,2 | 40 Métal, 20 Énergie | ×1,5 sur corvettes |
| Tourelle lourde | 300 | 2,0 | 2,8 | 90 Métal, 30 Énergie, 10 Cristal | ×1,5 sur croiseurs, cadence lente |
| Lance-missiles | 200 | 1,4 | 3,4 | 70 Métal, 40 Énergie | ×1,5 sur frégates, zone |
| Bastion | 600 | 0 | 2,0 | 90 Métal, 30 Énergie | **bouclier** : −35 % de dégâts reçus par tout ce qui est à portée ; Garde de nuit : −50 % |
| Entrepôt | 400 | 0 | — | 60 Métal | détruit : la moitié du stock au-delà de 600 est perdue |
| Chantier | 350 | 0 | — | 80 Métal, 20 Cristal | détruit : file d'entraînement perdue |
| Extracteur / Antenne / Amplificateur / Comptoir | 250 | 0 | — | inchangés | |

- **Pierre-feuille-ciseaux** : ×1,5 conservé, appliqué au DPS.
- **Ciblage** : automatique selon la priorité de l'unité, modifiable par le joueur présent (« focus »
  sur une cible), et par la doctrine (« protège l'entrepôt avant la station »).
- **Variance** : ±10 % sur chaque salve, seedée (le combat reste rejouable).
- **Réparation** : 5 PV/s pour les installations d'un système connecté et sans hostile ; les
  vaisseaux se réparent à quai (10 PV/s) si le système a un Chantier, 2 PV/s sinon.
- **Retraite** : ordre *Rentrer* à tout moment ; les unités quittent le plateau par le bord le plus
  proche en subissant les tirs pendant la sortie. Le Général retraite automatiquement sous 30 % de PV
  de flotte si la doctrine le permet.
- **Fin d'un engagement** : plus d'hostile armé sur le plateau. Le rapport de bataille (public,
  rejouable) est produit à ce moment.

### 4.2 Blocus et capture

- Un système est **sous blocus** quand une flotte hostile armée est sur le plateau sans tourelle ni
  défenseur armé en état de tirer (les installations à 0 PV ne comptent plus). Sous blocus : pas de
  production, pas de départ de convoi, pas de construction.
- **Capture** : 12 heures de blocus ininterrompu, comme aujourd'hui, sauf pour une capitale. Les
  installations à 0 PV passent au vainqueur *détruites* (à reconstruire) ; les autres, endommagées.
- **Raid** : l'ordre *Raider* vise une station-relais ou une installation précise et repart après.

### 4.3 Sur la carte, quand on n'y est pas

Le combat se joue de la même façon ; la carte montre un système en combat par un anneau rouge
pulsé et un compte de forces. Le joueur peut « entrer » à tout moment ; sinon le Général applique
la doctrine (focus, retraite, poser une tourelle si le stock local le permet).

## 5. Le Général, macro et micro

La doctrine gagne trois familles de règles, compilées comme aujourd'hui vers une politique :

- **Logistique** : seuils par système (« garde 300 d'Énergie à Ordra »), priorités de routes,
  escorte obligatoire au-delà d'une valeur de cargaison.
- **Défense** : ordre de priorité des cibles, seuil de retraite, tourelles à poser automatiquement
  (type et nombre) quand un système est attaqué et que le stock local le permet.
- **Présence** : ce que le Général fait *pendant* que le joueur est dans un combat (rien, ou
  seulement la logistique ailleurs) pour que la micro reste au joueur.

Le briefing raconte désormais les batailles avec la vraie chronologie (première salve, tourelle
tombée, retraite) et les convois perdus.

## 6. Le client : la vue Système

- **Entrer** : toucher deux fois une étoile, ou le bouton « Entrer » du panneau Système. Transition
  zoom continue depuis la carte (l'étoile grossit, les orbites apparaissent). **Sortir** : pincer ou
  bouton retour. La carte reste chargée derrière : le HUD (ressources globales, Tirage) ne change pas,
  les jauges locales s'ajoutent.
- **Rendu** : même DA que la carte (PixiJS, textures procédurales) : étoile au centre avec halo,
  trois orbites tracées, installations en modules hexagonaux orientés vers l'étoile, tourelles avec
  leur arc de portée quand on les sélectionne, vaisseaux qui suivent des trajectoires, tirs en traits
  lumineux, impacts, épaves brèves, jauge de PV au-dessus de ce qui combat.
- **Interactions tactiles** : toucher un emplacement vide → menu radial de construction avec coût et
  temps ; toucher une unité amie → ordres (attaquer une cible, protéger, rentrer) ; toucher une cible
  ennemie avec une sélection → focus. Glisser sur une orbite pour faire tourner la vue si le plateau
  déborde de l'écran.
- **Convois** : panneau latéral « Logistique » : routes, cargos, arrivées, création d'une route en
  trois touches (origine = ici, destination sur la carte, ressource et seuil).
- **Performance** : au plus 60 unités par plateau côté rendu (au-delà, groupement par escadrilles de
  5). Un seul plateau actif à la fois côté client.

## 7. Conséquences sur le reste

- **Score** : inchangé (systèmes connectés, Phares, titres). Un système sous blocus ne compte pas.
- **Économie** : la capacité d'entrepôt remplace l'accumulation infinie ; l'entretien superlinéaire
  reste ; les convois ajoutent un coût réel à la taille (temps, cargos, exposition).
- **Saisons accélérées** : le moteur de règles gagne la logistique et la défense automatiques ; les
  saisons à 300 PNJ restent l'outil d'équilibrage, avec deux nouveaux indicateurs : ressources perdues
  par entrepôt plein et convois interceptés.
- **Débutant** : rien de plus à comprendre pendant la première heure. Route automatique vers la
  capitale, deux cargos offerts, tourelle légère proposée par le coach dès la première menace.

## 8. Plan et migration

Trois paliers, chacun livré avec ses tests et une saison accélérée verte.

1. **Simulation** (`packages/sim`) : stock par système, entrepôts, cargos, routes, convois,
   interception ; combat continu (plateau, PV, DPS, ciblage, réparation, retraite) ; blocus par
   contrôle du plateau ; migration des commandes (`build` prend un emplacement, `train` produit sur
   place, nouvelles commandes `route_set`, `route_remove`, `convoy_send`, `focus`, `retreat`,
   `ambush`). Le moteur de règles gère routes et défense. Les instantanés changent de version (v2) avec
   migration depuis v1 : le stock global est déposé à la capitale.
2. **Serveur** (`apps/world`) : tick de combat à 1 s pour les plateaux actifs seulement, vue Système
   dédiée (`GET /api/system/:id`, flux WebSocket à 2 Hz sur abonnement), rapports de bataille
   chronologiques, Gazette qui raconte les sièges.
3. **Client** (`apps/web`) : vue Système, panneau Logistique, transitions, convois sur la carte, coach
   étendu (route, tourelle, entrer dans un combat).

Risques connus et parades : coût CPU du combat continu (ne simuler que les plateaux avec hostiles ;
budget mesuré en saison accélérée avec 50 combats simultanés) ; complexité perçue (routes
automatiques et défauts sains partout) ; asynchronie joueur absent (le Général défend, la capitale
est incapturable, le Bouclier de débutant reste).

## 9. Questions ouvertes

1. **Rotation des orbites** : décor animé (les installations tournent lentement) ou fixe pour la
   lisibilité ? **Recommandation : rotation très lente, arrêtée pendant un combat.**
2. **Cargo et Marché** : les Crédits restent globaux ; faut-il aussi les localiser ? **Non pour la
   Saison 0.**
3. **Taille du plateau selon le système** : 3 orbites partout, ou 2 pour les petits systèmes (1
   emplacement) ? **2 orbites pour les systèmes à 1 emplacement, 3 au-delà.**
4. **Escadrilles** : combattre unité par unité ou par escadrille de 5 dès la simulation ? **Par
   unité dans la simulation (le RPS reste lisible), groupement côté rendu seulement.**

## Résultats du palier 1 (saison accélérée, 56 jours, 40 colonies PNJ, graine `s1`)

| Mesure | Valeur |
|---|---|
| Systèmes connectés (médiane / max) | 8 / 31 |
| Relais construits / coupés | 570 / 7 |
| Engagements sur plateau | 50 |
| Systèmes capturés | 0 (les Généraux PNJ ne tiennent pas 12 h de blocus) |
| Trocs réglés | 1549 |
| Colonies bloquées à 1 système | 3 |
| Anomalies (stocks négatifs, famine) | aucune |
| Temps de calcul | 484 s (4 jours : 2,6 s) |

Lecture : l'économie locale ne casse pas l'expansion (médiane inchangée par rapport à 0001), la
capitale couvre l'entretien des jeunes avant-postes (règle ajoutée au palier 1 : si une station ne
peut pas payer sa moitié, l'autre extrémité puis la capitale paient). Les captures restent à
provoquer par des joueurs ou une doctrine plus agressive ; à revoir au palier 2 avec les rapports de
bataille. Le coût CPU croît avec le nombre de flottes (1720 en fin de saison, cargos compris) : le
serveur à 1 s/tick est loin de la limite, mais la saison accélérée mérite un regroupement des cargos
oisifs si elle dépasse dix minutes.

## Résultats du palier 2 (serveur)

- **Vue Système** : `GET /api/system/:id` (authentifié) renvoie le plateau d'un système : station au centre
  (PV), installations avec orbite, angle, PV et portée des tourelles, emplacements par orbite, stock local
  et capacité, files, flottes sur le plateau (position polaire, PV en fraction, composition seulement pour
  soi et ses alliés, flottes amarrées invisibles aux autres), arrivées prévues, routes, blocus avec heure
  de capture, bouclier du Bastion, bataille en cours avec les pertes par camp. Brouillard : secteur
  visible ou système à soi, sinon seul l'en-tête (nom, propriétaire).
- **Flux** : sur le WebSocket existant, `{"watch": systemId}` démarre le flux `{"type":"system"}` à 2 Hz
  maximum (une trame par changement, première trame immédiate), `{"watch": null}` l'arrête ; une seule
  vue surveillée par connexion, le calcul est partagé entre connexions qui regardent le même plateau.
- **Rapports de bataille** : `GET /api/battles` (liste des engagements où la colonie est partie ou
  propriétaire), `GET /api/battle/:id` (camps, pertes et destructions par camp, station tombée, issue
  `held` / `lost` / `skirmish` / `ongoing`, chronologie des salves). Le journal enregistre désormais la
  victime de chaque perte ; les journaux de plus de sept jours sont élagués au Tirage.
- **Ouverture d'engagement** : l'arrivée d'une flotte face à des hostiles ouvre l'engagement à l'instant
  (positions, journal), les dégâts suivent avec les ticks ; plus de latence d'un pas de simulation.
- **Gazette** : nouvelle rubrique « Les sièges » (les trois plus gros engagements du jour avec durée et
  coques perdues, blocus ouverts, stations tombées, convois perdus), en français et en anglais.
- Client : `net.ts` expose `watch(systemId)` et le signal `systemView` pour le palier 3.

## Résultats du palier 3 (client)

- **Vue Système** plein écran (`apps/web/src/map/SystemScene.ts`, scène PixiJS dédiée) : étoile et
  station-relais au centre avec arc de PV, trois orbites légendées (Industrie, Défense, Signal),
  emplacements libres cliquables, installations dessinées (textures procédurales par type) avec PV et
  arc de portée pour les tourelles, bouclier du Bastion, flottes sur le plateau interpolées entre deux
  trames (le flux est à 2 Hz), flottes amarrées dans une baie près de la station, arrivées prévues au
  bord avec compte à rebours, tirs et impacts pendant un engagement, rotation très lente du décor
  arrêtée pendant le combat. Transition d'entrée (zoom + fondu), bouton « Retour à la galaxie ».
- **Dock** à quatre onglets : Plateau (objet sélectionné, construction par orbite avec emplacements
  restants et coût vérifié sur le stock local, entraînement, files), Flottes (présentes, adverses,
  en approche, ordres : défendre, replier, scinder, cibler la station ou une installation, renforts
  depuis d'autres systèmes), Logistique (routes touchant ce système, envoi de convoi avec escorte),
  Bataille (combat en cours avec coques abattues par camp, rapports chronologiques).
- **Onglet Logistique** en vue galaxie : alerte d'entrepôts pleins, routes avec limite, création de
  route, envoi de convoi depuis n'importe quel système, convois en route avec cargaison et arrivée.
- **Carte** : convois dessinés avec une coque de cargo et leurs prochains sauts en pointillé,
  anneau rouge pulsant sur les systèmes engagés, alertes « Combat à X — Entrer » dans le bandeau.
- **Coach** : trois étapes de plus (route et cargos, tourelle à la première menace, sélection dans un
  système). Vérification visuelle en Chromium headless (bureau 1280×800 et mobile 390×844) avec une
  trame d'engagement synthétique via `#debug`.
