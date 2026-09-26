# Veille chatbrat.ai — captures du 26.09.2026

Demande de la session cloud (`docs/ops/REQUESTS.md`, 26.09) : son proxy refuse `chatbrat.ai`, `medium.com` et
`zplatform.ai`. Captures faites depuis gmk1 en **lecture seule** (curl, User-Agent navigateur), rien installé ni exécuté.

| Fichier | Contenu |
|---|---|
| `index.md`, `about.md`, `pricing.md`, `compose.md` (307 → connexion), `ai-chat-that-remembers.md`, `bratlog.md`, `careers.md` | texte de la page, méta, **scripts et bundles JS chargés**, domaines cités, `__NEXT_DATA__` quand présent ; le HTML brut est à côté (`*.html`) et les **en-têtes HTTP** dans `*.headers.txt` |
| `robots.txt`, `sitemap.xml` (+ `.md`, `.headers.txt`) | tels quels |
| `bratlog-why-character-ai-forgets-everything.md` | version blog de l'article Medium « The Science of Context Rot… » |
| `bratlog-ultimate-ai-roleplay-setup-guide-memory-lorebooks.md` | version blog de « The Ultimate AI Roleplay Setup Guide… » |
| `medium-feed.xml`, `medium-*.md` | les 10 derniers articles Medium de `@chatbrat.ai` (flux RSS, texte complet) — les deux articles demandés sont plus anciens que le flux et Medium refuse le profil hors navigateur ; leurs versions blog ci-dessus sont les mêmes textes |
| `zplatform-review.md` (+ `.html`, `zplatform.headers.txt`) | la revue zplatform.ai |

Repères lus dans les en-têtes et les bundles (index) : voir `index.md` § Scripts ; l'analyse (stack, tarifs, mémoire) est
à la session cloud.
