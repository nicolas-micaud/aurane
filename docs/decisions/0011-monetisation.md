# 0011 · Gagner un peu d'argent avec un jeu gratuit

Date : 26 septembre 2026. Proposition de la session cloud à la demande de Nick : « le jeu est free mais il faut être
capable d'en retirer un peu d'argent quand même ; une Colonie free, plusieurs ça doit coûter ; option tokens pour le
Général ou un compagnon supplémentaire ; pense à des idées pour ça. »
Statut : **décidé** (Nick, 26.09.2026 : « oui pour tout ; pour les prix on suit tes recos »). Les réponses aux six
questions sont dans la section « Décision » en fin de document ; le corps garde la proposition telle qu'elle a été
lue.

## Le cadre qu'on ne bouge pas

Le GDD (§ 1.2) tranche déjà deux choses, et elles restent vraies parce que c'est ce qui rend le jeu partageable :

- **Aucun achat n'influence la simulation.** Pas de ressource, pas de vitesse, pas de flotte, pas de vision achetable.
- **Ce qui survit à la saison tient au compte** : cosmétiques, titres, mémoires et personnalité du Général,
  statistiques. C'est exactement là que l'argent peut entrer sans toucher au jeu.

Ce qu'on vend alors, c'est **du temps avec le personnage, de la mémoire et de la présence** ; jamais de l'avantage.
Le test pour chaque idée : *un joueur qui ne paie rien peut-il gagner la saison contre un joueur qui paie tout ?* Si
la réponse n'est pas un oui franc, l'idée sort.

## Ce que ça coûte, pour savoir quoi faire payer

Le seul poste qui grandit avec les joueurs, c'est le Général. Ordre de grandeur avec les tarifs du contexte
(≈ 1 à 1,5 CHF par million de tokens sur Infomaniak, moins sur Scaleway ; `docs/ops/context.md`) :

| Usage | Tokens par appel | Coût par appel | Par joueur et par mois, au plafond gratuit (0008) |
|---|---|---|---|
| Message au Général (voix) | ≈ 1 500 entrée + 300 sortie | ≈ 0,002 CHF | 60/jour → **≈ 3,6 CHF** |
| Briefing au retour | ≈ 2 000 + 400 | ≈ 0,003 CHF | 8/jour → ≈ 0,7 CHF |
| Doctrine | ≈ 2 500 + 600 | ≈ 0,004 CHF | 12/jour → ≈ 1,4 CHF |
| Mémoires de fin de saison (modèle narratif) | ≈ 20 000 + 3 000 | ≈ 0,03 CHF | une fois |

Un joueur gratuit **qui tape les plafonds tous les jours** coûte donc 5 à 6 CHF par mois ; la moyenne réelle sera dix
fois moindre (le Conseil, le journal, la doctrine compilée et les réactions à chaud sont déterministes : zéro token).
L'infrastructure fixe (VM, Postgres, mémoire) est absorbée par le crédit Exoscale en S0. Conclusion : **le gratuit
tient tel quel**, et ce qui doit être payant, c'est *la conversation au-delà des plafonds* et *les objets de
mémoire* qui appellent le gros modèle.

## Les idées, de la plus sûre à la plus discutable

### 1. Le Mécène : l'abonnement cosmétique et de mémoire

Un seul abonnement, un seul nom dans l'univers (proposition : **Mécène**, ou **Signal Or**). Il ne donne rien dans la
simulation. Il donne :

- **Le Général au long cours** : plafonds de conversation multipliés (par exemple 200 messages par jour au lieu de
  60), sans changer de modèle pour les conseils (même voix, même analyse pour tous ; on paie du *temps*, pas de la
  *qualité de conseil*).
- **Les Mémoires étendues** : la lettre du matin (un briefing narratif quotidien, gros modèle, dans la voix du
  Général), les mémoires de saison longues et illustrées (carte finale rendue, batailles) au lieu du résumé d'une
  page, l'export PDF « le livre de ma saison ».
- **La mémoire longue** : le Général du Mécène garde les faits de toutes ses saisons ; le gratuit garde la dernière.
  (À trancher : c'est « de la mémoire », pas de l'avantage ; mais c'est aussi la promesse de base du jeu. Je
  propose : tout le monde garde tout, le Mécène a des mémoires *plus riches*, pas *plus longues*.)
- **Les cosmétiques** : skins de relais, blason animé sur la page publique, titre honorifique porté dans la Gazette
  (« Mécène de l'Aurane »), couleur de nom dans le Palmarès, un thème de carte.
- **La Gazette** : une mention discrète des Mécènes en pied de page de la Gazette (les gens paient pour être vus
  soutenir ; c'est ce que font les pages de podcasts et les jeux indés qui vivent).

Prix indicatif : **5 CHF par mois** ou **25 CHF la saison** (huit semaines, donc un peu moins de deux mois, le
tarif saison est le plus lisible dans un jeu saisonnier). Chatbrat vend 4,99 $ pour 1 750 messages par semaine sur
un petit modèle ; nous sommes dans la même fourchette avec un objet plus riche.

### 2. Les jetons du Général : le paiement à l'acte

Pour ceux qui ne veulent pas d'abonnement : un **paquet de jetons** (nom dans l'univers : **Éclats de Signal**), qui
achète des unités de conversation au-delà des plafonds et des objets de mémoire à l'unité.

- 3 CHF → 300 messages supplémentaires (ils ne périment pas dans la saison ; à la fin de la saison, ils périment,
  comme les Crédits : on ne stocke rien d'une saison à l'autre, cohérent avec le GDD).
- Objets à l'unité : une **lettre** commandée au Général sur un sujet (« raconte-moi la bataille de Kessa »), une
  **carte de bataille** illustrée à partager, un **portrait** de Colonie, un **changement de nom** de Colonie, les
  mémoires longues sans abonnement.

Règle stricte : les Éclats n'achètent **jamais** quoi que ce soit que la simulation lit. Pas de Crédits de Marché,
pas de vitesse de construction, pas de vision. Et le Général répond toujours, même à zéro Éclat : au-delà du
plafond, il passe en **mode dégradé** (0008 : réponses en personnage, sans appel au modèle) au lieu de se taire ;
le paywall doit se sentir comme « il est fatigué », pas comme un mur.

### 3. Le Compagnon : un second personnage sur la même Colonie

C'est l'idée la plus intéressante et la plus « Aurane ». Pas un second Général (deux mémoires, deux Conseils : c'est
ce que 0010 refuse), mais un **personnage d'un autre métier**, purement narratif et conversationnel :

- **Le Chroniqueur** : il écrit. Journal de bord quotidien dans un style choisi (épique, sec, ironique), chronique
  d'alliance, éloge funèbre d'une flotte perdue, cartes de bataille. Il ne conseille pas, il raconte. C'est le
  générateur de contenu partageable du GDD (§ 11), rendu personnel.
- **L'Émissaire** : il parle aux autres. Il rédige les messages diplomatiques dans le ton de ta faction, résume les
  échanges d'alliance, tient la mémoire des promesses tenues et trahies (« Corvan t'a déjà lâché deux fois »).
  Attention : il touche à l'information sociale, pas à la simulation ; acceptable, à surveiller.
- **L'Archiviste** : il connaît les Anciens. Lore, histoire des Phares, ce qui s'est passé à cet endroit les saisons
  précédentes (Palmarès). Un guide de l'univers, pour ceux qui aiment le décor.

Un Compagnon a sa propre personnalité (même mécanique de fiches JSON que les Généraux, 0008), sa propre voix dans le
panneau du Général (un second onglet, ou un second interlocuteur dans le même fil, qui parfois intervient dans la
conversation avec le Général : « le Chroniqueur note que c'est ta troisième défaite au même pont »). Inclus dans
Mécène, ou 3 CHF la saison par Compagnon à l'unité. Coût : le même que le Général (petit modèle), plus les objets
narratifs (gros modèle) qui sont déjà comptés au point 1.

Ce que ça apporte au-delà de l'argent : la promesse « des personnages qui se souviennent » devient une petite
troupe, c'est ce que chatbrat vend avec ses « scénarios à distribution », mais ancré dans une partie réelle.

### 4. La seconde Colonie : là où il faut être honnête

Nick : « une Colonie free, plusieurs ça doit coûter ». 0010 recommande **une Colonie active par compte et par saison
en S0**, avec un critère de réouverture en S1 (seconde Colonie **sœur**, isolée : ni troc, ni convoi, ni Transit,
ni alliance commune, ni Garde, visible comme telle sur sa page publique).

Faire payer cette seconde Colonie est **la seule idée de cette liste qui touche à la simulation** : une Colonie de
plus, c'est plus de présence dans la galaxie, deux paires d'yeux, deux voix en alliance. Les garde-fous de 0010
neutralisent l'essentiel (rien ne circule entre les deux), mais pas tout. Trois façons de le rendre acceptable :

- **La vendre comme ce qu'elle est : une seconde partie, pas un renfort.** Isolée, dans une **autre région** que la
  première (placement imposé, loin), avec son propre Général. C'est « jouer deux parties », comme deux comptes chez
  un jeu de plateau en ligne. Prix indicatif : **8 CHF la saison**. Maximum deux Colonies par compte.
- **La réserver aux comptes établis** : accessible seulement après une saison complète (compte ancien), ce qui coupe
  l'usage « Colonie jetable pour espionner ».
- **La mettre au tarif Mécène** plutôt qu'à l'unité, pour qu'elle reste un extra pour les fidèles, pas un produit
  d'appel.

Ma recommandation : **pas en S0** (on ne sait pas encore si la demande existe, et 0010 a passé une semaine à fermer
cette porte). On prépare l'entitlement dans le schéma, on mesure les comptes qui en recréent un second pour ça, on
ouvre en S1 si les chiffres le disent. Si Nick veut l'ouvrir plus tôt, alors avec les trois garde-fous ci-dessus.

### 5. Les alliances : l'argent collectif

- **Le Bastion** : une page d'alliance personnalisée (bannière, devise, chronique d'alliance par un Chroniqueur
  partagé), payée par l'alliance (un membre Mécène la débloque pour tous : cadeau visible, bon pour le recrutement).
- **La Gazette d'alliance** : édition privée quotidienne, gros modèle, pour les alliances de plus de dix.

### 6. Plus tard, hors S0

- **Le livre de la saison** : mémoires du Général imprimées (impression à la demande), 25 à 35 CHF. Objet unique,
  très partageable, marge correcte. C'est le produit qui raconte le mieux « ce jeu a une mémoire ».
- **« Amenez votre propre Général »** (GDD § 11) : API payante pour brancher son agent, 10 CHF la saison. Pour les
  développeurs ; se raconte tout seul.
- **Sponsoring de la Gazette** : une ligne « la Gazette d'aujourd'hui vous est offerte par … » (du natif, jamais de
  bannière dans le jeu). Seulement si le trafic justifie, seulement des marques compatibles avec l'univers.
- **Pas de publicité dans le jeu**, pas de vidéo récompensée, pas de boîtes à butin : incompatible avec le ton et
  avec « le produit, c'est le trafic » (le trafic vient du partage, la pub le tue).

## Ce que ça change à l'architecture

- **Entitlements sur le compte** (0010) : une table `entitlements(account_id, kind, season_id nullable, until,
  source)` ; kinds `patron`, `tokens` (solde), `companion:<id>`, `second_colony`, `cosmetic:<id>`. Le monde lit les
  entitlements pour les plafonds LLM et les cosmétiques ; **la simulation ne les voit jamais** (c'est vérifiable :
  `packages/sim` n'importe rien qui vienne des comptes ; un test le garantit).
- **Paiement** : pas de carte chez nous, jamais. Deux voies :
  - **Stripe** (Checkout + webhooks) : le standard, 2,9 % + 0,30. Mais Stripe ne collecte pas la TVA à notre place.
    Pour une SàRL suisse qui vend des services numériques à des consommateurs de l'UE, la TVA du pays du client
    est due **dès le premier euro** (pas de seuil pour un vendeur hors UE), avec inscription au guichet OSS
    non-UE. C'est faisable, c'est de la paperasse.
  - **Un marchand officiel** (*merchant of record* : Paddle, Lemon Squeezy) : il est le vendeur légal, collecte et
    reverse la TVA partout, prend 5 à 8 %. Pour une structure d'une personne, je recommande **celui-ci pour
    commencer** ; on passe à Stripe si le volume justifie.
  - En Suisse : TVA non due sous 100 000 CHF de chiffre d'affaires mondial ; à surveiller, pas un sujet en S0.
- **PWA, pas de magasin d'applications** : les paiements web restent à nous (pas de commission de 30 %, pas
  de règles d'achat intégré). Argument de plus pour rester en PWA, à écrire dans le GDD.
- **Le mode dégradé du Général** (0008) devient une fonctionnalité produit : c'est ce que voit un joueur gratuit
  au plafond, il doit être charmant.
- **Le Compagnon** réutilise toute la couche personnage (fiches, mémoire structurée, files de jobs) ; c'est surtout
  du contenu (trois fiches FR/EN) et un second interlocuteur dans le panneau.

## Ordre proposé

1. **S0 (bêta fermée)** : rien à vendre, mais tout à mesurer : messages par joueur et par jour, joueurs au plafond,
   demande de seconde Colonie, partage des mémoires. Un bouton **« Soutenir Aurane »** dans l'onglet Compte, vers une
   page qui explique le modèle et prend les e-mails des intéressés (zéro paiement, zéro TVA, une mesure d'intention).
2. **S1** : Mécène (abonnement saison) + Éclats + un premier Compagnon (le Chroniqueur, parce qu'il produit du contenu
   partageable, donc du trafic). Marchand officiel.
3. **S2** : seconde Colonie si mesurée, Bastion d'alliance, livre de la saison.

## Questions à Nick

1. **Le principe** : d'accord pour « on vend du temps avec les personnages et de la mémoire, jamais de l'avantage »,
   avec le test « un gratuit peut-il gagner la saison contre un payant » ?
2. **La seconde Colonie** : S1 après mesure (ma recommandation), ou dès que possible avec les trois garde-fous
   (isolée, autre région, comptes établis) ?
3. **Le Compagnon** : lequel en premier ? Chroniqueur (contenu partageable), Émissaire (social), Archiviste (lore) ?
4. **Le paiement** : marchand officiel (Paddle ou Lemon Squeezy, TVA gérée, 5 à 8 %) ou Stripe direct (moins cher,
   OSS à gérer) ? Et qui : la fiduciaire de ninabot a-t-elle un avis sur la TVA UE ?
5. **Les prix** : Mécène 25 CHF la saison, Éclats 3 CHF les 300, Compagnon 3 CHF la saison, seconde Colonie 8 CHF
   la saison. Trop bas, trop haut ? En CHF affichés, ou en euros pour les joueurs de l'UE ?
6. **S0** : on pose le bouton « Soutenir Aurane » (page d'intention, e-mails) dès la bêta, oui ou non ?

## Décision (Nick, 26.09.2026)

Nick a dit oui à l'ensemble et laissé les prix à la recommandation de la session cloud. Ce qui est tranché :

1. **Le principe** : on vend du temps avec les personnages, de la mémoire et de la présence, jamais de l'avantage.
   Le test reste : *un joueur qui ne paie rien peut-il gagner la saison contre un joueur qui paie tout ?* Un test du
   dépôt garantit que `packages/sim` n'importe rien qui vienne des comptes ni des entitlements.
2. **La seconde Colonie** : pas avant **S2**, après mesure (Grok confirme la réserve de 0010) ; si elle ouvre, avec
   les trois garde-fous (isolée, autre région, comptes établis) et au tarif ci-dessous.
3. **Le Compagnon** : le **Chroniqueur** en premier (il produit le contenu partageable, donc le trafic) ; Émissaire
   et Archiviste ensuite, selon la demande.
4. **Le paiement** : **marchand officiel** (Paddle ou Lemon Squeezy, à choisir par Nick avec la fiduciaire) dès la
   première vente : il est le vendeur légal, collecte la TVA du pays du client, affiche le prix dans la monnaie
   locale. Stripe direct seulement si le volume justifie un jour la paperasse OSS. Jamais de carte chez nous.
5. **Les prix** (amendés après la lecture de Grok, `docs/analyse/RETOUR-GROK-2026-09-26.md`) :

   | Objet | Prix | Note |
   |---|---|---|
   | Mécène | **12 CHF la saison** (ou 5 CHF le mois) | 25 était trop haut pour un jeu qui vient de naître ; 12 se dit « le prix d'un livre de poche » |
   | Éclats de Signal | **3 CHF les 300 messages** | périment **30 jours après l'achat**, pas à la saison : on n'achète pas pour perdre |
   | Compagnon | **3 CHF la saison** par Compagnon, inclus dans Mécène | |
   | Seconde Colonie (S2 au plus tôt) | **8 CHF la saison** | deux Colonies par compte au maximum |
   | Livre de la saison (plus tard) | 25 à 35 CHF | impression à la demande |

   Affichage : CHF en Suisse, euros dans l'UE, via la conversion du marchand officiel ; un seul prix de référence en CHF
   dans le code et la documentation.
6. **S0** : le bouton **« Soutenir Aurane »** est un **vrai achat unique** dès la bêta (5 CHF, sans entitlement de jeu :
   un titre de fondateur cosmétique, porté dans la Gazette et le Palmarès, et l'entrée sur la liste des Mécènes de la
   première heure), pas seulement une page d'intention. Réserve maintenue : c'est une vente de service numérique, donc
   marchand officiel et TVA dès S0 ; la plomberie de paiement est déclenchée plus tôt, ce qui est aussi le moyen de la
   tester sur dix personnes avant mille.

Ce qui suit de ces décisions, dans l'ordre : le choix du marchand officiel (Nick), la table `entitlements` et son test
d'étanchéité (session cloud), le bouton « Soutenir Aurane » dans l'onglet Compte (session cloud), le Chroniqueur en S1.
