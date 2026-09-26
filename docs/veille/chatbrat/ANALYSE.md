# chatbrat.ai — analyse (session cloud, 26.09.2026)

Demande de Nick : « ça va apparemment assez deep dans les personnages ; vois si tu peux connaître leur stack, si c'est
efficace ; ils misent sur la mémoire persistante aussi. » Sources : les captures de ce dossier (session locale, lecture
seule), la revue zPlatform, les fiches d'annuaires et le post Indie Hackers du fondateur. Ce qui est **lu** est distingué
de ce qui est **déduit**.

## 1. Ce que c'est

Plateforme web de chat avec personnages, jeu de rôle et « compagnons », 18+ mais **SFW pour l'instant** (leurs
conditions parlent d'une « current SFW launch phase »), gratuite en bêta. Positionnement martelé sur toutes les pages :
l'alternative à Character.AI qui **n'oublie pas** et qui ne met **pas la mémoire derrière un paywall**, et à SillyTavern
sans installation. Fondateur unique visible, Garret Williams, réalisateur passé par le marketing ; « petite équipe »,
aucun poste ouvert ; lancé vers mai 2026. Catalogue **écrit par l'équipe** (56 personnages, 66 scénarios dans le
sitemap), pas par les utilisateurs : c'est le choix inverse de Character.AI, et c'est pour ça que l'écriture tient
(la revue : « plus fine que tout le reste de la catégorie cette année », note 7/10).

## 2. La stack (lue dans les en-têtes, la CSP et les bundles)

| Couche | Ce qu'on lit | Source |
|---|---|---|
| Front | **Next.js** compilé avec **Turbopack** (`/_next/static/immutable/chunks/…`, `turbopack-*.js`) | `index.md` § Scripts |
| Hébergement | **Vercel** (`server: Vercel`, `x-vercel-id: fra1::iad1::…` : edge Francfort, origine **us-east**) | `index.headers.txt` |
| Données, auth, temps réel, fichiers | **Supabase** (projet `cfsahuxbjxbdyrvpogxi`, `connect-src` https + **wss** : Postgres, Auth, Realtime, Storage) | CSP |
| Devant | **Cloudflare** (`cloudflareinsights`, `cloudflare-cdn-cache-control`) | en-têtes |
| Analytique | **PostHog** (US), **GA4** (`G-2CNND1XE17`), **Microsoft Clarity** (enregistrement de sessions), Vercel Analytics | CSP, scripts |
| Cookies | `cb_guest` (identité invité 30 jours), `cb-region=CH`, `cb-nsfw-blocked=1` (géo-blocage du contenu adulte) | `set-cookie` |
| Modèles | **fournisseurs externes** (« no-training / no-retention terms with our AI providers », au pluriel), rebaptisés **BratMind**, **BratMind 2.0**, **BratMind Advanced** | pricing, pied de page |
| SEO | `content-signal: search=yes, ai-input=yes, ai-train=yes` : ils **invitent** les robots IA à indexer et entraîner | en-têtes |

Déduit, pas lu : trois « BratMind » = trois modèles tiers de coût croissant derrière une marque maison ; le gratuit à
39 messages par jour sans compte suppose un modèle open-weight bon marché au premier étage. Aucun indice de vecteurs
ni d'embeddings dans ce qui est public. Sécurité : CSP stricte, HSTS preload, COOP ; c'est propre.

C'est la stack **indie standard 2026** : Next + Vercel + Supabase, zéro infra propre, et trois outils d'analytique
comportementale posés dès le départ. Le contraire de notre choix (VM Exoscale, Postgres et mémoire dédiée, Cloudflare
devant) : eux paient à l'usage et ne possèdent rien, nous possédons tout et payons fixe.

## 3. Les tarifs (page `pricing`, aperçu bêta, paiements non actifs)

| | Basic | Pro | Premium |
|---|---|---|---|
| Prix | 4,99 $/mois | 12,99 $/mois (10,75 en annuel) | 23,99 $/mois |
| Modèle | BratMind | BratMind 2.0 | BratMind Advanced |
| Messages **par semaine** | 1 750 | 3 000 | 7 000 |
| Personnages / scénarios créés | 5 / 2 | 25 / 5 | illimité |
| Voix et image | « bientôt » | ✓ | ✓ |

Gratuit sans compte : 39 messages par jour. Mémoire « gratuite, sans plan », mais la revue relève que les conditions
des **Charms** (monnaie interne) vendent de la « capacité de mémoire supplémentaire » : la promesse « pas de paywall »
a déjà une fissure. Choix intéressant : des **réserves hebdomadaires** plutôt qu'un plafond quotidien (« une grosse
journée ne te bloque pas »).

## 4. La mécanique de mémoire et de personnage (lue dans leurs deux guides)

Quatre couches assemblées dans un ordre fixe au lancement d'une session (« Compose ») :

1. **Personnage** : bio, champ *Personality* en texte libre (« esquive la vulnérabilité par l'humour sec »), **curseurs
   0–100** (chaleur, dominance, joueur, intensité), *Opening Lines* (le premier message, « vaut plus que cent lignes
   de bio »), et un **lorebook**.
2. **Monde** : type, description, **lieux nommés**, factions, tags. Injecté en bloc.
3. **Scénario** : narration d'ouverture (préfixe de scène) et **distribution** (cast) : c'est l'unité de jeu.
4. **Arc narratif** : prémisse, 1 à 10 chapitres titrés, temps émotionnels, décisions obligées. Injecté en **suffixe
   dynamique** qui « se tisse » après les premiers échanges. Règle d'or : « l'arc est une direction, pas une liste ».

**Lorebook** : entrées déclenchées par **mots-clés**, avec une **position d'injection** (avant le bloc personnage, après,
ou « à une profondeur » donnée de l'historique), injectées quand le mot apparaît et **retirées** quand le sujet change.
Pas d'embeddings : du lexical, déterministe, gratuit en jetons.

**Mémoire persistante** : « des faits structurés extraits au fil du chat, stockés contre ce compagnon et **relus avant
chaque réponse** » (revue) ; deux registres, **faits du personnage** et **profil du joueur** (« addressable memory
slots ») ; le joueur peut **épingler des lore cards**. Limites qu'ils écrivent eux-mêmes, et c'est à leur honneur :
« pas une transcription infinie », « un invité ne se souvient pas de toi demain » : **la mémoire n'existe qu'avec un
compte** ; l'invité n'a que la session en cours (vérifié par la revue : rechargement = oubli).

## 5. Est-ce efficace ?

- **Sur la continuité de conversation, oui** : la revue voit trois faits plantés repris en une ligne, et surtout un
  personnage qui **refuse d'inventer** un souvenir qu'il n'a pas, ce qui est le bon mode d'échec.
- **Sur l'écriture, oui** : le catalogue maison et la fiche de personnage à quatre niveaux donnent une voix stable.
- **Sur le produit, des fissures** : filtre par **liste de phrases** (« take me through your day » rejeté), l'erreur
  affichée à l'utilisateur au lieu de la raison, la mémoire vendue en page d'accueil mais absente pour l'invité, et la
  contradiction Charms / « pas de paywall ».
- **Sur la nature de la mémoire** : c'est la mémoire d'une **conversation**. Elle retient ce qui a été *dit*. Elle n'a
  aucun fait vérifiable en dehors du chat, parce qu'il n'y a pas de monde derrière.

## 6. Ce que ça change pour Aurane

Notre avantage n'est pas la quantité de mémoire, c'est **sa source** : le Général se souvient de ce qui s'est **passé**
(la simulation, le journal, les choix pris ou écartés au Conseil), pas de ce qu'on lui a raconté. Un fait vérifiable
vaut plus qu'un fait déclaré, et un chat pur ne peut pas l'avoir. Et notre mémoire marche **sans compte**, dès la
première minute : eux la réservent aux inscrits.

À prendre chez eux, dans l'ordre :

1. **Le lorebook à déclencheurs lexicaux, avec position d'injection.** Nos règles du jeu et nos fiches de personnage
   partent aujourd'hui en bloc à chaque appel ; les découper en entrées déclenchées par les mots du joueur (« relais »,
   « tourelle », « Phare », le nom d'un voisin) réduit les jetons et colle à la philosophie du routeur (0009). Zéro
   modèle pour décider quoi injecter.
2. **La mémoire visible et épinglable.** Un écran « ce que ton Général sait de toi » dans l'onglet Compte (on a déjà
   l'export), avec *épingler* et *oublier* par fait : ça rend la promesse tangible et c'est de la confiance.
3. **Les arcs : « une direction, pas une liste ».** C'est la règle d'écriture de nos chapitres hebdomadaires (à
   faire) : des titres d'intention, jamais des cases à cocher, tissés en suffixe après le premier Tirage de la semaine.
4. **Les réserves hebdomadaires** plutôt que des quotas par jour pour le Général (`talk` est à 60/jour) : une grosse
   soirée ne doit pas couper la parole.
5. **Les curseurs de personnalité 0–100** ne sont pas pour nos Généraux (leur caractère est fixe et c'est voulu), mais
   l'idée vaut pour la **doctrine** : on a déjà expansion et agression, on peut nommer les axes dans leurs mots.

À ne pas prendre : la niche compagnon adulte, le filtre par liste de mots, le flot de pages « alternative à X »
(29 dans le sitemap) tant qu'on n'a pas de produit à défendre derrière, et les trois outils d'analytique
comportementale : une Gazette publique vaut mieux qu'un enregistrement de sessions.
