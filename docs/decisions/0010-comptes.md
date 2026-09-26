# 0010 · Les comptes : une identité, des appareils, des Colonies

Date : 25 septembre 2026. Proposition de la session cloud à la demande de Nick (deuxième test téléphone, en PWA) :
« il n'y a pas de menu compte pour se déconnecter ; je ne suis pas fan du lien pour brancher un appareil à une
Colonie, je veux que ce soit *account based* ; et la possibilité d'avoir plusieurs Colonies doit être étudiée. »
Statut : **à trancher par Nick** (les cinq questions de la fin).

## Le constat

- Aujourd'hui l'identité, c'est un jeton opaque dans le `localStorage` du navigateur, lié à une Colonie
  (`players.token_hash → colony_id`). Pas de compte, pas de session, pas de « moi » : un appareil = une Colonie.
- Pour jouer depuis un second appareil, on génère un **lien d'appareil** (24 h, signé) et on le colle ailleurs.
  Ça marche, c'est à peu près ce que fait un jeu sans compte, mais c'est un geste d'informaticien : on copie une URL
  d'un téléphone vers un ordinateur. Et en PWA il n'y a pas de barre d'adresse : sans menu, on ne peut ni se
  déconnecter ni savoir qui l'on est.
- Le GDD a déjà tranché la direction (§ 12 « Jouer sans compte », § 11 « Persistance entre saisons ») : on arrive et on
  joue en dix secondes ; le compte (**passkey ou lien magique par e-mail**) n'est demandé que pour **garder** la
  Colonie au-delà de l'appareil ; le compte porte ce qui survit à la saison : cosmétiques, titres, mémoires et
  personnalité du Général, statistiques. Aucune friction avant le premier relais.
- La revue S0 (§ 2, multi-comptes) protège le jeu des Colonies jetables par une **empreinte d'origine** (IP hachée) :
  fragile (un foyer, un réseau mobile) et prévue pour être remplacée par une empreinte de compte « quand les comptes
  existeront ». Les comptes sont donc aussi une mesure d'intégrité, pas seulement de confort.

## Ce qu'on propose

### 1. Le modèle : compte, sessions, Colonies

```
accounts        id, created_at, lang, display_name, email (nullable), email_verified_at
credentials     id, account_id, kind ('passkey'), public_key, sign_count, transports, label, created_at, last_used_at
sessions        token_hash (pk), account_id, device_label, created_at, last_seen_at, revoked_at
account_colonies account_id, colony_id, season, role ('owner'), created_at
```

- Le jeton porteur actuel devient une **session** ; rien ne change côté protocole (`Authorization: Bearer`, `?token=`
  sur le WebSocket). Une session a un nom d'appareil (« iPhone de Nick », déduit du *user agent*, renommable) et se
  révoque une par une : « Se déconnecter » ici, « Déconnecter partout ».
- **Chaque joueur existant reçoit un compte**, silencieusement, à la migration : un compte *invité* par entrée de
  `players`, dont le jeton devient la première session. Personne ne perd rien, personne n'a rien à faire.
- La Colonie est rattachée au compte (`account_colonies`), plus au jeton. `engine.authenticate(token)` rend le compte
  et la Colonie active ; le reste du monde ne voit pas la différence.

### 2. Deux façons d'être soi, dans cet ordre

1. **Passkey d'abord.** Une touche (Face ID, empreinte, code de l'appareil), pas d'e-mail, pas de mot de passe, et le
   trousseau (iCloud, Google, Bitwarden) la synchronise entre les appareils du joueur : c'est exactement « brancher un
   appareil » sans lien à copier. Fonctionne en PWA sur iOS 16+ et Android. Côté serveur : `@simplewebauthn/server`
   (enregistrement, authentification, compteur), quatre routes (`/api/auth/passkey/register|login`, options puis
   vérification). **Le RP ID est le domaine** : une passkey créée sur `starnet.uno` ne vaut rien sur
   `play.playaurane.com`. À n'ouvrir que sur le domaine définitif (ou après le basculement DNS).
2. **Lien magique par e-mail**, comme seconde méthode et comme **secours** (un joueur qui a perdu son téléphone et son
   trousseau). Le lien vaut 15 minutes, s'ouvre sur n'importe quel appareil et y pose une session. Il faut un
   expéditeur : ninabot n'a pas de SMTP actif aujourd'hui (`docs/ops/context.md`). Options : SMTP/API **Infomaniak**
   (déjà client, hébergé en Suisse, cohérent avec le repli LLM), ou un service transactionnel (Brevo, Resend). Deux
   modèles FR/EN, texte brut d'abord. Adresse : `noreply@playaurane.com`, SPF/DKIM chez Cloudflare.

Le **lien d'appareil** disparaît de l'interface dès que les passkeys sont en place ; la route reste un temps pour le
support (un admin peut dépanner un joueur), puis s'éteint.

### 3. Le menu Compte (client)

Un onglet **Compte** dans le panneau (dans le « ⋯ » sur téléphone, avec l'avatar-initiale à côté), et, sur la page
d'accueil, « J'ai déjà une Colonie » devient « Se connecter » (passkey, ou e-mail).

- En-tête : nom, faction, Général, « depuis le … », état du compte : *invité* (rien ne survit à cet appareil) ou
  *protégé* (passkey · e-mail).
- **Garder ma Colonie** : « Ajouter une passkey » (une touche), « Ajouter un e-mail de secours ».
- **Appareils** : la liste des sessions avec leur dernière activité ; « Déconnecter » par ligne, « partout ».
- **Mes Colonies** : celle-ci, et l'historique des saisons passées (mémoires du Général, score, titres) ; voir § 4.
- **Données** : exporter / effacer la mémoire du Général (déjà `GET|DELETE /api/memory`), supprimer le compte.
- Langue, installation (déjà là), et **Se déconnecter**. Un invité qui se déconnecte est prévenu : « Sans passkey ni
  e-mail, cette Colonie ne sera plus accessible depuis cet appareil. Ajouter une passkey (une touche) ? » Les deux
  boutons : *Ajouter une passkey* (recommandé), *Me déconnecter quand même*.

### 4. Plusieurs Colonies par compte : l'étude

Trois sens possibles, à ne pas confondre.

**a) Dans le temps : l'historique.** Une Colonie par saison, et le compte garde toutes les saisons : c'est le GDD
(mémoires du Général, titres, statistiques). **Oui, évident**, c'est même la raison d'être du compte. Un joueur
consulte ses anciennes Colonies dans « Mes Colonies », le Général en cite des extraits en saison suivante.

**b) En même temps, dans la même saison.** C'est là qu'il faut réfléchir, parce que la revue S0 a passé une semaine à
empêcher exactement ça : une Colonie secondaire qui nourrit la principale (troc, convoi, transit, relais prêtés).
Avec des comptes, la règle « même origine » devient enfin fiable : **deux Colonies du même compte ne peuvent ni
troquer, ni convoyer, ni signer de Transit, ni entrer dans la même alliance, ni se donner la Garde**, quelle que soit
l'IP. Les contournements restants : la capture (une Colonie secondaire se laisse prendre ses systèmes ; la règle
« capture sans Réseau » les rend neutres en 24 h, donc peu rentable) et le renseignement (deux paires d'yeux : une
Antenne chez l'une éclaire l'autre). Le coût pour le jeu est ailleurs : la promesse est *un Général qui te connaît*,
une relation, un protagoniste. Deux Colonies en parallèle, c'est deux Généraux, deux mémoires, deux Conseils par
Tirage, et un joueur qui se partage. Sur téléphone, avec une heure de Tirage, c'est aussi le meilleur moyen de ne
tenir aucune des deux.

Recommandation : **une Colonie active par compte et par saison en S0**, avec deux soupapes qui couvrent les vrais
besoins :
- **Recommencer** : un joueur peut renoncer à sa Colonie (elle passe au Général, comme une absence définitive, ou
  s'éteint) et en fonder une autre dans la saison, une fois par semaine au plus. Il garde son compte et son historique.
- **Changer de Général** sans changer de Colonie : c'est le personnage qui apporte le renouvellement, pas une seconde
  Colonie ; à étudier avec la couche LLM (la mémoire passe-t-elle d'un Général à l'autre ?).

Et un **critère de réouverture** : si à la fin de S0 on mesure une demande réelle (joueurs qui recréent des comptes
pour une seconde Colonie, ou qui le demandent), on ouvre en S1 une seconde Colonie **isolée** (les interdictions
ci-dessus), visible comme telle sur sa page publique (« Colonie sœur de … »), pas plus de deux.

**c) À plusieurs sur une Colonie.** Deux comptes sur la même Colonie (un couple, un parent et un enfant, un mentor) :
le vrai cas d'usage derrière « plusieurs appareils » chez certains joueurs. Techniquement c'est un rôle dans
`account_colonies` (`owner` / `officer`, l'officier ne peut pas supprimer ni transférer). Pas en S0, mais le schéma
le permet sans migration : on le note.

### 5. Ce que ça change au jeu

- Les guard-rails multi-comptes basculent de l'IP au compte (règle `sameOriginTrade` évaluée sur `account_id` quand il
  existe, IP sinon) : plus juste pour les foyers, plus dur pour les tricheurs.
- Les invitations (bêta fermée) se consomment par compte, pas par jeton : un compte invité peut recommencer sans
  nouveau code.
- La Gazette et les pages publiques ne changent pas (elles parlent de Colonies, jamais de comptes).
- RGPD : un compte sans e-mail ne contient que des clés publiques ; avec e-mail, l'adresse est la seule donnée
  personnelle ; « supprimer le compte » efface sessions, clés, e-mail et mémoire du Général, et anonymise la Colonie
  (elle reste dans l'histoire de la saison sous son nom de Colonie).

## Découpage

| Lot | Contenu | Qui | Dépend de |
|---|---|---|---|
| A · Menu Compte | onglet Compte, appareils (sessions), déconnexion avec garde-fou, export/effacement de mémoire, langue et installation regroupés | cloud (client) + world (`sessions`, `/api/sessions`, `DELETE /api/session`) | rien |
| B · Passkeys | tables `accounts`, `credentials`, `account_colonies` ; migration des `players` ; routes WebAuthn ; « Ajouter une passkey », « Se connecter » sur l'accueil | cloud (world + client) | domaine définitif (RP ID) |
| C · E-mail | expéditeur (Infomaniak ou service), lien magique, e-mail de secours, modèles FR/EN | local (expéditeur, secrets) + cloud (routes, client) | choix de l'expéditeur |
| D · Règles | `sameOriginTrade` sur le compte ; invitations par compte ; « Recommencer » (renoncer et refonder) | cloud (sim + world) | B |
| E · Retrait du lien d'appareil | l'interface d'abord, la route ensuite | cloud | B stable une semaine |

A peut partir tout de suite et rendre la PWA honnête (on sait qui on est, on peut sortir). B est le cœur ; il
attend le domaine `play.playaurane.com` en place, sinon les passkeys créées seront à refaire.

## Ce qui revient à Nick

1. **Passkey d'abord, e-mail en secours** : d'accord, ou l'inverse (e-mail d'abord, plus universel mais avec la
   friction de la boîte mail et un expéditeur à monter avant tout) ?
2. **Une Colonie active par compte et par saison en S0**, avec « Recommencer » et l'historique complet : d'accord ?
   La seconde Colonie isolée attend une mesure en fin de S0.
3. **Expéditeur des e-mails** : Infomaniak (SMTP ou API, Suisse) ou un service transactionnel ? À faire monter par la
   session locale, secrets dans Vaultwarden.
4. **Calendrier** : le lot B seulement quand `play.playaurane.com` est le domaine servi (les passkeys y sont liées).
   Le lot A tout de suite.
5. **Le lien d'appareil** : on le retire de l'interface dès que les passkeys marchent (recommandé), ou on le garde en
   « méthode avancée » ?
