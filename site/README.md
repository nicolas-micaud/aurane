# playaurane.com — la landing

Site statique généré par `build.mjs` (Node 22, aucune dépendance) à partir de `content/`, publié sur la branche
`gh-pages` par le workflow `.github/workflows/site.yml`. GitHub Pages sert la racine de cette branche ;
`CNAME` = `playaurane.com`. Voir `docs/landing/PLAN.md` pour les décisions.

## Arborescence

- `content/sections.json` : les textes de la landing d'origine (pitch, lore, règles, factions, Général, Saison 0),
  extraits tels quels de l'ancien `index.html`. **Ne pas les réécrire** ; ce fichier est la source des règles.
- `content/strings.json` : les chaînes d'interface FR/EN (navigation, accroche, formulaire, pied de page, page de
  confidentialité). Les trois « points » du jeu citent des phrases de `sections.json` ; un test vérifie qu'elles y
  figurent mot pour mot.
- `styles.css` : la feuille de style, inlinée dans chaque page.
- `public/` : icônes, logo, fond, visuels du jeu (copiés depuis l'ancien site).
- `media/` : `hero.webm` (le Réseau qui s'étend, capturé dans le jeu), `hero-poster.webp`, `bg.webp`, `og.png`.
  Régénérables (voir plus bas) ; le build fonctionne sans eux (image de repli).
- `dist/` : la sortie (ignorée par git).

## Pages produites

`/` (français, `hreflang` `x-default`, redirige une fois vers `/en/` un navigateur non francophone sans choix
mémorisé), `/fr/`, `/en/`, `/fr/regles/`, `/en/rules/`, `/fr/confidentialite/`, `/en/privacy/`, `404.html`,
`sitemap.xml`, `robots.txt`, `site.webmanifest`, `CNAME`, `.nojekyll`.

## Construire et prévisualiser

```
node site/build.mjs                      # écrit site/dist
python3 -m http.server 4180 -d site/dist # ou tout serveur statique
```

Variables d'environnement (toutes facultatives) : `SITE_ORIGIN` (défaut `https://playaurane.com`), `PLAY_URL`,
`WAITLIST_URL` (défaut `https://api.playaurane.com/waitlist`), `TURNSTILE_SITEKEY` (clé publique du widget),
`DISCORD_URL`, `X_URL`, `CONTACT_EMAIL`. Les liens Discord, X et l'adresse de contact n'apparaissent que si la
variable est posée : jamais de lien mort.

## Le formulaire de liste d'attente

`POST multipart/form-data` sur `WAITLIST_URL` avec : `email` (obligatoire), `name` (facultatif), `lang` (`fr`|`en`),
`consent` (`1`, case cochée obligatoire côté client, à exiger aussi côté serveur), `website` (pot de miel, doit
rester vide), `cf-turnstile-response` (jeton Turnstile), `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
`utm_term` (depuis l'URL, mémorisés pour la session), `referrer` (site d'origine, hors playaurane.com), `page`
(chemin de la page d'inscription). Réponse attendue : `{"ok":true}` ou `{"error":"invalid"|"captcha"|"rate"|…}`.
La validation de l'adresse, la déduplication et la limite de débit sont côté serveur.

## Régénérer les médias

Le jeu doit tourner en local (client construit et serveur avec des données de départ) :

```
npm run build && (cd apps/web && npx vite build)
SNAPSHOT_DIR=/tmp/aurane-landing PORT=8080 TIME_SCALE=300 GALAXY_RADIUS=6 SEASON_SEED=landing-1 node apps/world/dist/main.js &
(cd apps/web && npx vite preview --port 4173) &
node site/tools/media.mjs 20 45     # 20 s de vidéo après 45 s de jeu accéléré
```

Le script crée une Colonie, laisse son Général étendre le Réseau (le joueur est « absent »), enregistre le canvas
de la carte en WebM VP9 (`MediaRecorder`, ~850 kb/s), prend le poster, convertit le fond en WebP et compose
l'image sociale 1200 × 630. Pas de MP4 : le ffmpeg disponible n'encode pas H.264 ; le WebM suffit aux navigateurs
actuels et le poster couvre le reste.

## Tests

`npx vitest run site` : le build produit toutes les pages, aucun lien `#` seul ni vide, `hreflang` et canonical
présents, les citations des trois points figurent dans les règles, le sitemap liste chaque page, le formulaire
porte les champs attendus, les pages restent sous une taille raisonnable.
