# Landing playaurane.com — plan de transformation en page de conversion

Date : 25 septembre 2026. Mission de Nick (autonome). Ce document est le plan puis le compte rendu.

## 0. Ce que l'exploration a trouvé

- **Où vit la landing** : sur la branche `gh-pages` de ce dépôt (pas dans `main`, pas sur Cloudflare Pages). GitHub
  Pages sert la racine de cette branche ; `CNAME` = `playaurane.com` (un `CNAME` identique est aussi gardé à la
  racine de `main`, sans effet). Aucun build : un `index.html` de 38 Ko issu du gabarit **Dimension** (HTML5 UP,
  licence CCA 3.0 : attribution requise) avec jQuery, Font Awesome complet (1,7 Mo de polices), Sass du gabarit, et
  la section « Elements » de démonstration encore présente.
- **Défauts constatés** : trois images référencées n'existent pas (`images/pic01.jpg`, `pic02.jpg`, `pic03.jpg`,
  images de démo du gabarit) ; bilingue empilé FR puis EN dans chaque section ; le « Jouer · Play » du haut de page
  contredit « bêta sur invitation » ; aucune balise OG/Twitter, pas de sitemap ni de robots ; le texte « On joue sans
  compte » côtoie « Tu as un code ? ».
- **Backend d'inscription** : il existe déjà. Le formulaire actuel poste en `multipart/form-data` sur
  `https://api.playaurane.com/waitlist` (champs `name`, `email`, `lang`, `website` en pot de miel, jeton Cloudflare
  Turnstile, clé de site publique `0x4AAAAAAFCSIqXFBc1hwh8k`) et attend `{ ok: true }` ou
  `{ error: "captcha" | "invalid" | "rate" }`. Ce service n'est pas dans ce dépôt : il a été posé par la session
  locale (Worker Cloudflare, dépôt ninabot-pro, d'après `images/mail-header.jpg` « visuel du mail de confirmation »).
  Depuis ce conteneur, `playaurane.com` et `api.playaurane.com` sont injoignables (politique réseau) : le contrat
  ci-dessus est déduit du code du formulaire, pas vérifié en direct.
- **Le jeu tourne en local** (`apps/world` + `apps/web`) : la capture vidéo du Réseau qui s'étend est possible.
- **Outils disponibles** : Chromium headless + Playwright, le ffmpeg de Playwright (`/opt/pw-browsers/ffmpeg-1011`),
  pas de `cwebp` ni `sharp` : les WebP sont produits par Chromium (canvas → `image/webp`).

## 1. Décisions d'architecture

- **Source dans `main`, sortie sur `gh-pages`.** Le site devient un dossier `site/` de ce dépôt : contenu en
  dictionnaires FR/EN, un générateur Node sans dépendance (`site/build.mjs`) qui écrit `site/dist/`, un workflow
  GitHub Actions qui publie `site/dist` sur la branche `gh-pages` (déclenchement manuel ou push sur `main` touchant
  `site/`). La configuration Pages (source `gh-pages`, racine) ne change pas. Pas de gabarit tiers : HTML et CSS
  écrits pour la page, zéro JavaScript hors le sélecteur de langue, le formulaire et Turnstile.
- **Textes conservés tels quels.** Les paragraphes de la landing actuelle sont extraits automatiquement de
  `index.html` (branche `gh-pages`) vers `site/content/sections.json`, sans réécriture : seuls le découpage et la
  mise en page changent. Une exception demandée par la mission : la ligne « On joue sans compte … Tu as un code ? »
  devient une ligne qui dit que la Saison 0 est sur invitation, puis ouverte à tous sans compte.
- **Langues** : `/fr/` et `/en/` sont deux pages complètes ; `/` sert la version française avec `hreflang`
  `x-default` et un script qui, sans choix mémorisé (`localStorage`), envoie vers `/en/` un navigateur anglophone.
  Le sélecteur FR/EN mémorise le choix. Règles : `/fr/regles/` et `/en/rules/`. Confidentialité :
  `/fr/confidentialite/` et `/en/privacy/`.
- **Structure de la landing** : hero (logo, tagline inchangée, accroche « Ton Général IA joue pendant que tu dors. »,
  vidéo du jeu, un seul appel à l'action « Rejoindre la liste d'attente », lien secondaire « J'ai un code
  d'invitation » vers play.playaurane.com) → le jeu en trois points (Relier, le Tirage, le Général) → lore court →
  factions en cartes → Saison 0 + formulaire → pied de page. Les règles complètes (Relier, Tirage, Marché,
  Construire, Combattre, Diplomatie, Phares) partent sur la page Règles avec table des matières et ancres.
- **Liste d'attente** : on garde le backend existant (`api.playaurane.com/waitlist`) et on enrichit le formulaire :
  consentement explicite obligatoire, `utm_*` et `referrer` en champs cachés remplis au chargement, pot de miel et
  Turnstile conservés, messages de confirmation et d'erreur par langue. La validation, la déduplication et la limite
  de débit sont côté Worker (existant) ; ce qu'il doit stocker en plus est listé dans « Demandes ». Option
  documentée si le Worker ne convenait pas : une fonction Pages + D1 (non retenue : Pages n'héberge pas ce site).
- **Vie privée** : page dédiée (éditeur ninabot Sàrl, Genève) : ce qu'on stocke (e-mail, pseudo facultatif, langue,
  date, source d'acquisition, adresse IP hachée par Turnstile côté Cloudflare), pourquoi (prévenir de l'ouverture),
  combien de temps (jusqu'à la désinscription ou un an après la fin de la Saison 0), comment se désinscrire.

## 2. Ordre de travail

1. `site/` : contenu extrait, générateur, CSS, pages FR/EN, règles, confidentialité, sitemap, robots, manifest.
2. Médias : vidéo WebM en boucle du Réseau qui s'étend (jeu local accéléré, capture du canvas), poster WebP, image
   OG 1200 × 630, fond en WebP.
3. Formulaire : consentement, UTM, referrer, messages ; contrat backend documenté.
4. Workflow de déploiement `site.yml` ; tests du build (aucun lien `#`, hreflang, sitemap, tailles).
5. Lighthouse (mobile et desktop, FR) ; captures Playwright desktop et mobile, FR et EN, avant et après.
6. PR avec captures, scores et la liste des décisions attendues de Nick.

## 3. Compte rendu (rempli au fil du travail)

Voir la PR et `docs/landing/README.md` une fois le travail livré.
