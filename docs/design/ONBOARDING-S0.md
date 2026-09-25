# Onboarding progressif de la Saison 0 — spécification

Date : 25 septembre 2026. Revue de design S0, risque 6. Spécification de produit ; l'interface n'est pas livrée ici.
Principe : **le Général est le guide**. Le joueur ne lit pas un tutoriel, il reçoit des ordres à valider et des
explications de son Général, dans sa voix, au moment où la mécanique devient utile. Ce qui n'est pas encore
débloqué n'est pas caché par un mur : il est **absent des écrans** jusqu'à son déblocage, puis présenté par une
phrase du Général. Un vétéran peut tout débloquer d'un mot (« montre-moi tout »).

## Ce qui existe déjà

- Le coach par objectifs (PR 4) : six étapes cochées automatiquement (toucher une étoile, relier, entrer dans le
  système, construire, donner une doctrine, attendre le Tirage), persistées dans le navigateur.
- Le Général conversationnel (0006) et son journal (0007), le compte rendu du Tirage, les alertes.
- La pression corsaire dès le deuxième jour (0007) et le bouclier de débutant (72 h à 56 jours, 21 h à 7 jours).

## Les paliers

Les paliers se déclenchent sur des **faits de jeu**, pas sur l'horloge, avec un plancher de temps pour ne pas tout
ouvrir en dix minutes. Chaque palier : condition, ce qui apparaît, ce que dit le Général (une ligne par personnage
dans `packages/general`, données FR/EN), et l'objectif du coach qui le remplace.

| Palier | Condition (ET plancher) | Apparaît | Objectif du coach |
|---|---|---|---|
| **0 · Relier** | création | carte, onglet Système, « Relier », stocks, minuteur du Tirage, le Général (chat) | toucher une étoile ; relier une voisine |
| **1 · Produire** | 1 relais construit | le plateau du système, Extracteur, Entrepôt, Antenne, l'onglet Logistique en lecture | construire une installation ; lire le compte rendu du Tirage |
| **2 · Marché** | 1er Tirage vécu ET 3 systèmes reliés | Marché régional, troc, Comptoir, Décrets, le Général « tient le Marché » | vendre un surplus ou donner une doctrine de marché |
| **3 · Tenir** | 6 h de jeu ET (Chantier disponible OU première alerte de flotte en approche OU sortie du bouclier dans 12 h) | Chantier, tourelles, Bastion, Garde de nuit, flottes (ordres Défendre, Rentrer) | poser une tourelle ; choisir sa Garde |
| **4 · Frapper** | sortie du bouclier ET 1 vaisseau de guerre | ordres Raider, Bloquer, Embuscade ; Rium et raffinerie mis en avant ; rapports de bataille | une sortie annoncée par le Général, ou refusée avec ses raisons |
| **5 · Parler** | jour 2 ET 1 voisin humain visible | traités, alliances, émissaires, agents (espion, sabotage), Gazette mise en avant | proposer un pacte ou une alliance |
| **6 · Les Phares** | 10 systèmes reliés OU un Phare à portée | Phares, Cristal comme objectif, score de saison, Renaissance et son plancher | relier ou sonder un Phare |

Planchers : palier 2 au plus tôt à la première heure ; palier 3 au plus tôt à 6 h ; palier 5 au plus tôt au
jour 2 (aligné sur la pression corsaire : on apprend à tenir avant d'être frappé, à frapper avant de négocier).

## Le Général comme guide

- À chaque palier, une **première parole** du Général (sans appel au modèle, comme `inboundWarning`) : Vane
  explique la défense en trois chiffres, Kestrel propose une cible, Oriel-Neuf donne le prix, Solen présente le
  voisin. Une ligne, un bouton « Montre-moi » qui ouvre l'écran concerné.
- Le Général **refuse** un ordre hors palier avec une phrase de personnage plutôt qu'un message d'erreur
  (« Raider ? On n'a pas une coque. Chantier d'abord. »), et propose le pas précédent.
- Le journal du Général sert de rappel : chaque déblocage y laisse une ligne (« Palier 3 : Chantier ouvert »).
- Sur téléphone, le nombre d'actions visibles par écran suit le palier : trois au palier 0, jamais plus de cinq.

## Mécanique de déblocage (serveur)

- `Colony.onboarding: { tier: number; unlockedAt: number[] }` dans l'instantané ; calculé côté simulation à
  chaque Tirage et à chaque commande (`advanceOnboarding(w, colony)`), les PNJ à `tier = 6` d'emblée.
- Les commandes hors palier sont **refusées** par `apply()` avec la raison `locked:<palier>` (le Général
  traduit) ; la vue porte `me.onboarding` pour que le client masque le reste. Un mot au Général (« tout ouvrir »,
  « je connais le jeu ») passe au palier 6 : l'entrée sans friction reste la règle pour qui sait déjà.
- Les paliers ne changent **aucune** règle de simulation : un joueur au palier 1 est attaquable dès la fin de son
  bouclier comme tout le monde ; la Garde de nuit par défaut (0 h–8 h UTC) le protège en attendant le palier 3.

## Ce que ça change pour la bêta

Le premier week-end a montré des menus trop nombreux et un tutoriel bloqué sur les relais. Les paliers rendent le
premier quart d'heure à trois verbes : toucher, relier, construire. Tout le reste arrive par la bouche du Général,
quand c'est utile. À valider sur un testeur qui ne connaît pas le jeu (jalon M6 du GDD).
