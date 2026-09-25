# Revue de design de la Saison 0 — risques, règles, mesures

Date : 25 septembre 2026. Mission de Nick (autonome). Six risques identifiés par une revue avant la Saison 0 ;
pour chacun : le problème, deux ou trois options, la recommandation, les chiffres, et ce qui est implémenté dans
`packages/sim` derrière des **règles de saison** (`packages/sim/src/rules.ts`, `SeasonRules`, valeurs par défaut =
Saison 0, `LEGACY_RULES` = le prototype d'avant, pour mesurer chaque garde-fou à zéro). Scénarios reproductibles :
`packages/sim/test/review-s0.test.ts` (graines fixes) ; mesures de saison : `node tools/season-sim/review.mjs`.
Les textes publics de la landing n'ont pas été touchés.

## 1. Fin de saison prématurée

**Problème.** Une alliance qui rallume les Sept Phares et les tient 24 h termine la saison pour tout le monde.
Rien ne l'empêchait en semaine 3 : le scénario `R1 · legacy` le reproduit (bloc de six Colonies, Phares tenus au
jour 14, saison finie au jour 15, `w.ended.reason = 'renaissance'`). Deux trous aggravants trouvés au passage :
un Phare rallumé **restait au bloc même après la capture de son système** (`litBeacons.by` n'était pas mis à
jour), et la Fédération n'entrait pas dans le calcul du bloc.

**Options.**

1. Date plancher seule : pas de Renaissance avant une fraction de la saison. Simple, lisible, mais un bloc
   dominant peut « camper » sur les Phares dès la semaine 3 et tout le monde attend.
2. Plancher + tenue croissante avec la taille du bloc + Alerte publique qui fragilise les Phares du bloc : la
   coalition dominante doit tenir plus longtemps et sous le feu. Retenue.
3. Plafond de taille des Fédérations : déjà là de fait (la Fédération lie deux Colonies d'une même alliance,
   plafonnée à vingt) ; documenté plutôt qu'ajouté.

**Recommandation (implémentée).**

| Règle | Valeur S0 | Paramètre |
|---|---|---|
| Plancher : la Renaissance ne compte pas avant | 75 % de la saison (jour 42 sur 56 ; jour 5,25 sur 7) | `renaissanceEarliestFraction` |
| Tenue exigée | 24 h pour un bloc de 5 au plus, +2 h par membre au-delà (54 h à 20) | `renaissanceHoldHours`, `renaissanceHoldHoursPerMember`, `renaissanceFreeMembers` |
| Alerte des Phares | dès 5 Phares tenus par un bloc : événement public, ses systèmes-Phares se capturent en 6 h de blocus au lieu de 12 | `beaconAlertAt` |
| Un Phare suit la capture de son système, compte remis à zéro | oui | `beaconFollowsCapture` |
| Rattrapage des autres joueurs | l'Alerte (Gazette, alertes) et la capture rapide sont le rattrapage : un seul Phare repris remet le compte à zéro | — |

**Résultat en simulation** (`review-s0.test.ts`, R1) : sous les règles S0 le même bloc tient les Sept Phares une
semaine entière en semaines 3–4 sans fin de saison ; le premier instant où la saison peut finir est le jour 42 ;
la tenue d'un bloc de vingt est de 54 h ; sous Alerte, un rival prend un système-Phare en 6 h, le Phare change de
mains et le compte repart. Objectif « aucune coalition ne tue une saison avant la semaine 6 » : atteint par
construction (plancher), et la semaine 6 elle-même exige une tenue longue et défendue.

## 2. Multi-comptes (jeu sans compte)

**Problème.** Des Colonies jetables nourrissent un compte principal : troc (don pur), convoi livré dans
l'entrepôt de l'autre (même effet, découvert en revue : le convoi déchargeait dans n'importe quel entrepôt), et
**transit** (une Colonie fraîche rejoint l'alliance du principal : ses relais, payés avec son stock de départ,
comptent dans le Réseau du principal). Scénario `R2 · legacy` : une Colonie créée à l'instant donne 280 Métal et
180 Énergie au principal en un troc, réglé au Tirage.

**Options.**

1. Interdire tout transfert aux jeunes Colonies : tue l'entraide légitime (un ami qui donne de l'Énergie à un
   nouveau).
2. Restreindre le **sens** et le **volume** : une jeune Colonie peut recevoir, pas donner ; une paire de
   Colonies échange au plus une valeur par jour ; même origine = rien. Retenue : l'entrée reste sans friction,
   le débutant ne perd rien (il n'a rien à donner).
3. Pertes de transfert (taxe) : pénalise aussi les alliances honnêtes ; écartée, gardée en réserve.

**Recommandation (implémentée).**

| Règle | Valeur S0 | Paramètre |
|---|---|---|
| Jeune Colonie (< 24 h ou sous bouclier) : pas de don | donne ≤ 1,25 × ce qu'elle demande (prix de référence) ; convoi vers un entrepôt étranger interdit | `youngColonyHours`, `giftRatioMax` |
| Jeune Colonie : pas de transit | ne prête ses relais à personne (alliance comprise), ne peut ni accorder ni recevoir de Transit ou Fédération | `youngColonyHours` |
| Plafond par paire | 600 de valeur par jour, trocs et convois confondus, dans les deux sens | `pairTransferCapPerDay` |
| Même origine | aucun troc, convoi, transit ni Fédération entre Colonies de même empreinte | `sameOriginTrade` |
| Empreinte d'origine (serveur) | `sha256(AUTH_SECRET, ip)` tronqué, posée à la création (`Colony.origin`), IP prise dans `cf-connecting-ip` | `apps/world` |

**Résultat en simulation** (R2) : le don de 460 de valeur par une Colonie fraîche est refusé
(`young colonies cannot gift`) ; un troc équilibré passe ; adultes, 500 de valeur passent puis 200 sont
refusés (`pair transfer cap reached`), le convoi de 300 aussi, et le plafond se rouvre le lendemain ; deux
Colonies de même origine ne peuvent ni troquer ni signer de Transit ; une jeune Colonie dans l'alliance du
principal n'apporte aucun relais à son Réseau (`transitSet`), tout en pouvant rouler sur ceux de ses alliés.
**Ferme à jetables** (`review.mjs transfers` : un principal, trois Colonies jetables dans son alliance qui lui
donnent 90 % de leur stock chaque heure pendant un jour) :

| Règles | Offres acceptées | Systèmes reliés du principal après 24 h | Métal du principal |
|---|---|---|---|
| prototype | 72 | **15** | 1 002 |
| Saison 0 | 0 (72 refusées) | 3 | 180 |

Sous les règles du prototype, trois jetables valent cinq fois la croissance d'une Colonie honnête en un jour.

## 3. Équilibrage des factions et les Oracles

**Constat de départ.** L'avantage des Oracles **n'était implémenté nulle part** (ni simulation, ni Général, ni
client) : la fonction `oracleHint` existait, personne ne l'appelait. Concordat (portée), Guilde (frais, région)
et Corsaires (coût, vitesse) l'étaient. Toute mesure antérieure des Oracles mesurait donc une faction sans bonus.

**Implémenté.** `nextDrawHint(w)` (la bande, connue dans une fenêtre de `oracleHintMinutes` avant le Tirage, 0 =
désactivé) ; exposé dans la vue (`me.oracleBand`) ; et le Général des Oracles **vend à l'avance**, à 95 % du
dernier prix, ce que ses systèmes de la bande annoncée vont produire en plus (×3), avant la baisse de prix que ce
surplus provoque, et diffère ses achats de cette ressource. C'est l'arbitrage automatique redouté, joué par les
PNJ à chaque décision (toutes les 30 minutes : avec une fenêtre de 15 minutes, les PNJ ne l'exploitent plus ; un
humain attentif si).

**Mesure.** `node tools/season-sim/review.mjs factions` : saisons de 7 jours, 40 Colonies PNJ, rayon 6, personas
équilibrées entre factions, 3 graines ; score moyen par faction et écart à la moyenne, fenêtre 60 min, 0 et 15.

| Fenêtre des Oracles | Concordat | Guilde | Oracles | Corsaires |
|---|---|---|---|---|
| 60 min (défaut) | 42,5 (+42 %) | 25,5 (−15 %) | 27,6 (−8 %) | 24,2 (−19 %) |
| désactivée | 40,0 (+39 %) | 22,7 (−21 %) | 26,6 (−8 %) | 26,0 (−10 %) |
| 15 min | 40,0 (+39 %) | 22,7 (−21 %) | 26,6 (−8 %) | 26,0 (−10 %) |

Score moyen par Colonie après 7 jours (écart à la moyenne des quatre factions). Lecture : l'indice des Oracles vaut
environ **+1 point** (27,6 contre 26,6, soit +4 %) joué mécaniquement par un Général toutes les 30 minutes ; à 15
minutes il n'est plus exploitable par les PNJ (résultat identique à « désactivé »). Les Oracles restent **dans la
cible** quelle que soit la fenêtre. Le vrai déséquilibre est ailleurs : le **Concordat à +42 %** avec sa portée de
relais +10 %, parce qu'au rayon 6 la portée décide du nombre d'étoiles reliables, donc du score.

**Second banc : la portée du Concordat** (`review.mjs concordat`, 5 graines × 7 jours × 40 Colonies, rayon 6) :

| `concordatRangeMult` | Concordat | Guilde | Oracles | Corsaires |
|---|---|---|---|---|
| ×1,10 (GDD) | 36,8 (+29 %) | 26,3 (−8 %) | 27,0 (−5 %) | 23,8 (−16 %) |
| ×1,05 | 29,1 (+7 %) | 30,2 (+11 %) | 26,3 (−3 %) | 23,1 (−15 %) |
| ×1,00 | 27,5 (+1 %) | 29,0 (+7 %) | 26,8 (−1 %) | 25,3 (−7 %) |

Le bruit à cinq graines est d'environ ±7 % (la Guilde oscille entre −8 % et +11 % sans que rien la concerne).
**Décision implémentée : +5 %** (`concordatRangeMult: 1.05`, GDD § 2.3 mis à jour) : le Concordat passe de +29 %
à +7 %, dans la cible, en gardant sa saveur. Les **Corsaires** restent sous la cible (−15 %) dans chaque banc :
leurs capitales sont **toutes** placées dans des systèmes « repaire » (50 sur 50 dans cinq graines, aucune autre
faction), un biais de placement voulu pour la couverture, qui semble coûter en croissance.

CORSAIRES_RESULTAT

**Recommandation.** Garder la fenêtre des Oracles à 60 minutes (l'avantage est réel mais petit, +4 %, et c'est
la saveur de la faction) ; le levier de repli `oracleHintMinutes = 15` reste disponible si des joueurs humains,
plus habiles qu'un Général, en tiraient davantage. Concordat à +5 % : fait. Corsaires : voir ci-dessus, décision à
Nick (biais de repaire ou compensation économique).

## 4. Densité de la galaxie

**Problème.** 469 secteurs × 10–16 systèmes pour 200 à 500 joueurs et 30 PNJ : la Saison 0 telle que le GDD la
décrivait ouvrait un plateau où un joueur pouvait passer des jours sans voisin (mesures de 0005 : au rayon 12 avec
40 Colonies, aucun contact le premier jour).

**Options.**

1. Taille calculée au Réveil d'après les inscriptions : juste au départ, faux dès que les inscriptions
   continuent (bêta sur invitation par vagues).
2. Anneaux qui s'ouvrent avec la population : la galaxie commence petite et grandit d'un anneau quand l'anneau
   extérieur est à moitié occupé ; les nouveaux venus arrivent sur le nouvel anneau, près de la bordure vivante.
   Retenue : la génération est déterministe **par secteur**, donc les secteurs existants ne bougent pas.
3. Les deux : taille de départ d'après les inscriptions, puis croissance. C'est ce que permet la règle
   (`GALAXY_RADIUS` de départ + `galaxyGrowth`).

**Recommandation (implémentée).** `galaxyGrowth = { enabled, rimOccupancy: 0.5, maxRadius: 12 }`, évaluée à
chaque Tirage ; `expandGalaxy` régénère la galaxie au rayon +1 avec le même `baseRadius` (géographie des
ressources inchangée pour les anciens secteurs, testé octet pour octet), les nouveaux systèmes sont ajoutés vides,
l'événement `galaxy.expanded` alimente la Gazette ; l'instantané porte `galaxyOptions` (le serveur compare le
rayon de base, pas le rayon courant, pour détecter un changement de saison). Départ conseillé : rayon 6 pour la
bêta (déjà posé, PR 8), croissance jusqu'à 12.

**Mesure.** `review.mjs contact` : heures avant qu'une Colonie ait une capitale étrangère à un secteur d'un de
ses systèmes (médiane), part des Colonies en contact avant 72 h, selon rayon et population ; puis la croissance
depuis le rayon 4.

| Colonies | Rayon | Secteurs | Secteurs par Colonie | En contact avant 72 h | Médiane (h) |
|---|---|---|---|---|---|
| 40 | 6 | 127 | 3,2 | 93 % | 1 |
| 40 | 8 | 217 | 5,4 | 85 % | 14 |
| 40 | 12 | 469 | 11,7 | 53 % | 70 |
| 120 | 8 | 217 | 1,8 | 100 % | 1 |
| 120 | 10 | 331 | 2,8 | 100 % | 1 |
| 250 | 10 | 331 | 1,3 | 100 % | 1 |
| 250 | 12 | 469 | 1,9 | 100 % | 1 |
| 500 | 12 | 469 | 0,9 | 100 % | 1 |

La Saison 0 du GDD (rayon 12, une quarantaine de Colonies le premier week-end) est le pire cas mesuré : la
moitié des joueurs sans voisin après trois jours. La règle de bon voisinage se lit dans la colonne « secteurs par
Colonie » : **entre 2 et 3 secteurs par Colonie**, tout le monde a un voisin dès la première heure sans être
collé (au-dessous de 1,5 les capitales se touchent, cf. 500 au rayon 12).

**Croissance depuis le rayon 4** (`review.mjs growth`, arrivées par vagues sur la première journée, deux jours) :

| Colonies | Rayon final | Secteurs | Secteurs par Colonie | Anneaux ouverts | Spawns refusés |
|---|---|---|---|---|---|
| 40 | 5 | 91 | 2,3 | 1 | 0 |
| 120 | 9 | 271 | 2,3 | 5 | 0 |
| 250 | 12 | 469 | 1,9 | 8 | 0 |
| 500 | 12 | 469 | 0,9 | 8 | 0 |

La croissance tient la densité entre 1,9 et 2,3 secteurs par Colonie jusqu'au plafond ; à 500 Colonies le plafond
de 12 serre (0,9), sans jamais refuser un spawn (un anneau s'ouvre aussi quand la bordure est pleine au moment
d'une création). Recommandation : `GALAXY_RADIUS=6` au départ de la bêta, croissance activée, plafond 12 ; porter
le plafond à 14 si la liste d'attente dépasse 400.

## 5. Trous de règles tranchés

| Question | Décision (GDD mis à jour) | Implémentation |
|---|---|---|
| Origine et circulation des Crédits | Crédits de saison uniquement. 300 à la fondation, +2 par système relié et par Tirage ; le teneur de marché PNJ (40 % / 200 % du prix de référence, 40 unités par ressource, région et Tirage) borne les prix ; puits : frais de Marché (5 %, 3 % avec Comptoir, ÷2 Guilde) et Décrets. Aucun transfert direct de Crédits entre Colonies. | déjà en place ; documenté (GDD § 5.3) |
| Garde de nuit | Heure de début choisie par le joueur (0 h UTC par défaut), effective aussitôt, **une modification par 24 h**. | `set_watch` refuse `watch changed recently` ; `watchChangeCooldownHours` |
| Système capturé si l'attaquant est lui-même coupé | Un système capturé non relié à la capitale du captor dans les **24 h** redevient neutre, installations en place ; les relais du captor vers lui tombent. Événement `system.lapsed`. | `captureGraceHours`, `SystemState.capturedAt`, `lapseCaptures` au Tirage |
| Flottes en route quand un relais tombe | Un ordre donné est exécuté : la flotte arrive à l'heure annoncée ; si le Réseau est tombé derrière elle, elle arrive hors Réseau et paie ses opérations en Rium. Les convois, qui avancent de saut en saut, se réacheminent à chaque étape. | comportement existant, pinné par un test (R5) |
| Phare et capture | Le Phare rallumé suit son système ; compte remis à zéro. | `beaconFollowsCapture` |

## 6. Onboarding progressif

Spécification livrée dans `docs/design/ONBOARDING-S0.md` : sept paliers déclenchés par des faits de jeu avec
planchers de temps (relier → produire → Marché → tenir → frapper → parler → Phares), le Général comme guide (une
parole par palier sans appel au modèle, refus en personnage hors palier), `Colony.onboarding` dans l'instantané,
commandes hors palier refusées avec la raison `locked:<palier>`, et « tout ouvrir » d'un mot pour les vétérans.
Aucune règle de simulation ne change avec le palier.

## Ce qui a changé dans le code

- `packages/sim/src/rules.ts` (nouveau) : `SeasonRules`, `DEFAULT_RULES`, `LEGACY_RULES`, `mergeRules`.
- `world.ts` : Renaissance (plancher, tenue croissante, Alerte des Phares, `captureHours`), Phare qui suit la
  capture, plafonds de transfert (troc et convoi), jeune Colonie, même origine, cooldown de la Garde, grâce de
  capture, croissance de la galaxie, `nextDrawHint` ; `diplomacy.ts` : `transitSet` filtre les jeunes Colonies
  et la même origine ; `galaxy.ts` : `baseRadius`, `expandGalaxy` ; `general.ts` : vente anticipée des Oracles ;
  `view.ts` : `me.oracleBand` ; `serialize.ts` : instantané v6 (règles, transferts, options de galaxie, Alerte).
- `apps/world` : empreinte d'origine à la création (`originHash`, en-tête `cf-connecting-ip`), détection de
  changement de saison par rayon de base, instantané depuis les options du monde.
- Tests : `review-s0.test.ts` (12 scénarios), migration v5 → v6.
- Outil : `tools/season-sim/review.mjs` (factions, premier contact, ferme à jetables).

## Décisions qui reviennent à Nick

1. **Fenêtre des Oracles** : 60 minutes (défaut) ou 15 ; voir le tableau des factions.
2. **Plancher de la Renaissance** : 75 % (semaine 6) est la valeur demandée ; 66 % (fin de semaine 5) laisserait
   une semaine de plus à la gloire. Paramètre `renaissanceEarliestFraction`.
3. **Plafond par paire** : 600 de valeur par jour ; à relever pour des alliances qui jouent la logistique de
   guerre (`pairTransferCapPerDay`), ou à lever entre alliés de plus de sept jours.
4. **Croissance de la galaxie** : activée par défaut (rayon 6 → 12 au fil des inscriptions) ; le rayon de
   départ reste `GALAXY_RADIUS`. Désactiver si tu préfères une carte fixe pour la bêta.
5. **Empreinte d'origine par IP** : deux joueurs d'un même foyer ne pourront pas s'échanger de ressources en
   Saison 0 ; alternative : ne poser l'empreinte qu'à partir de la troisième Colonie d'une même IP.
6. **Onboarding** : la spécification attend ton feu vert avant l'interface (jalon M6).
