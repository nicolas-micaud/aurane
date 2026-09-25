# 0007 — Le journal vivant : un événement par heure, des alertes, un Général qu'on voit agir

Date : 25 septembre 2026. Nick : « poursuis le projet, je testerai un peu plus tard une version plus
avancée ». Cette page livre les points 3 à 6 de la décision 0005 (§ 4) et la « suite possible » de 0006 : ce
qu'un joueur lit et ressent entre deux Tirages, sur téléphone d'abord.

## Ce qu'on livre

- **Le compte rendu du Tirage.** À chaque heure, chaque Colonie humaine reçoit une carte dans son Journal :
  ce que le Tirage a produit (les cinq ressources), les Crédits versés, combien de systèmes étaient reliés et
  combien dans les bandes tirées, ce qui a débordé des entrepôts, les relais éteints faute d'Énergie. C'est
  l'événement garanti par heure ; les PNJ n'en écrivent pas (personne ne les lit).
- **Le Journal lisible.** Chaque événement du monde devient une phrase en français ou en anglais, avec les
  noms (« Ilse Vantor met Kessa sous blocus », « Convoi arrivé à Orun »), un ton (rouge : subi ; vert : gagné ;
  neutre : le reste) et un horodatage en jour et heure de saison. Une ligne qui nomme un système le sélectionne
  sur la carte. L'onglet Journal porte un compteur de non-lus et devient un onglet principal sur téléphone.
- **Les alertes qui manquaient.** La bande d'alertes sous les jauges affichait les combats et blocus ; elle
  affiche maintenant, dans l'ordre : combats et blocus, **flottes hostiles en approche** avec le nombre de
  vaisseaux et l'heure d'arrivée (jaune), puis ce qui attend une réponse : offre de troc, traité proposé,
  invitation d'alliance (bleu). Trois lignes au plus, « et n de plus ».
- **La flotte en approche est un événement du monde** (`fleet.inbound`) : dès qu'un vaisseau de guerre part
  vers un système tenu par une autre Colonie non alliée, le propriétaire est prévenu avec l'heure d'arrivée. Le
  convoi et le retour au bercail n'alertent pas. C'est la tension de Neptune's Pride, décidée en 0005.
- **Le Général parle le premier.** Sur cet événement, le Général du joueur ajoute une ligne à la conversation,
  dans sa voix, sans appel au modèle : Vane pose une tourelle et demande qu'on entre dans le système, Kestrel
  propose de rendre la politesse, Oriel-Neuf chiffre la valeur exposée, Solen garde la porte ouverte à un
  émissaire. La langue est celle du dernier échange avec lui (français par défaut).
- **Le journal du Général.** Ses notes de décision, jusqu'ici jetées, sont désormais structurées
  (`{ kind, system?, colony? }`), conservées par Colonie (40 dernières, dans l'instantané) et lisibles dans
  l'onglet Général sous « Ce que j'ai fait » : « Relais vers Orun », « Tourelle posée à Kessa », « Sortie
  annulée : pas assez de Rium », « Expansion suspendue : l'Énergie ne suivrait pas ». Notre Screeps, gratuit.
- **Les Décrets, payés en Crédits** (GDD § 8 les prévoyait en Influence ; les Crédits dormaient, 0005 § 4.4).
  Trois décrets, publics, temporaires, un seul de chaque à la fois : **Portée** (+10 % de portée des relais,
  24 h, 120 Crédits), **Franchise** (frais de Marché nuls, 3 Tirages, 60 Crédits), **Longue Garde** (Garde de
  nuit de 12 h au lieu de 8, 24 h, 90 Crédits). L'événement est public et la Gazette les cite dans « La Trame
  politique » : tout le monde lit tes intentions. Cartes dans l'onglet Colonie.
- **La pression corsaire.** À partir du deuxième jour (Tirage 24), chaque Colonie PNJ Corsaire lance, au plus
  toutes les six heures, un raid **modeste** (six vaisseaux au plus, la flotte est scindée sinon) sur l'avant-poste
  **le moins défendu** d'un joueur humain hors bouclier de débutant, à quatre secteurs au plus. Le départ est
  annoncé comme n'importe quelle flotte en approche : le joueur a le temps de poser une tourelle, et apprend le
  plateau avant son premier vrai voisin. Le tutoriel vivant du GDD, version militaire.

## Ce que ça change dans le code

- `packages/sim` : événements `draw.recap`, `fleet.inbound`, `decree` ; `Colony.journal` et `Colony.decrees`
  (instantané v5, migration v4 → v5) ; commande `decree` ; effets des décrets dans `rangeContext`,
  `settleMarkets` et la Garde de nuit (`watchHours`) ; `decideCorsairPressure` dans le moteur du Général ;
  notes structurées (`GeneralNote`) et `recordNotes`. Sept tests dans `packages/sim/test/journal.test.ts`.
- `packages/general` : `inboundWarning` (le Général parle le premier) ; la Gazette cite les décrets.
- `apps/world` : les notes du Général vont au journal ; `speakFirst()` à chaque pas de simulation ; la langue
  du joueur est retenue pour ces lignes.
- `apps/web` : `ui/feed.ts` (événements et notes en phrases), Journal réécrit, alertes étendues, cartes de
  Décrets, journal du Général ; quatre onglets principaux sur téléphone (Colonie, Système, Général, Journal).

## Ce qu'on n'a pas fait (et pourquoi)

- **Refonte mobile complète** (0005 § 4, « trois ou quatre actions contextuelles par écran ») : elle mérite un
  test de Nick sur cette version d'abord ; le Journal et les alertes changent déjà la lecture du jeu au téléphone.
- **Mémoire longue du Général** et **voix** : après le premier week-end.
- **Rayon 6 et graine `beta-2`** : toujours une décision de Nick pour la prochaine saison (nouvelle galaxie).

## À mesurer au prochain banc

Avec `tools/season-sim/pace.mjs` : le nombre d'heures sans événement pour le joueur doit tomber à zéro (le
compte rendu horaire le garantit) ; le premier raid corsaire subi doit arriver entre l'heure 24 et l'heure 40
pour un joueur sans tourelle ; le journal du Général doit compter au moins une ligne par heure de jeu.
