# Bêta fermée : variables et procédure

Décidé le 24.09.2026. Une saison courte (7 jours) sur playaurane.com, 20 à 30 joueurs invités.

## Variables d'environnement du world server

| Variable | Rôle | Valeur bêta |
|---|---|---|
| `REQUIRE_INVITE` | une nouvelle Colonie exige un code d'invitation | `1` |
| `INVITE_CODES` | codes d'amorçage, séparés par des virgules, utilisables une fois chacun | quelques codes pour les premiers testeurs, le reste par l'admin |
| `ADMIN_TOKEN` | jeton des routes `/api/admin/*` (en-tête `x-admin-token`) ; absent = routes désactivées | secret Vaultwarden, 32 octets aléatoires |
| `AUTH_SECRET` | signe les liens d'appareil (`/#join=…`, 24 h) ; absent = aléatoire par processus, les liens meurent au redémarrage | secret Vaultwarden, 32 octets aléatoires |
| `PUBLIC_ORIGIN` | origine des liens d'appareil et des cérémonies passkey | `https://play.playaurane.com` |
| `RP_ID` | identifiant WebAuthn (décision 0010) ; absent = domaine enregistrable de `PUBLIC_ORIGIN` (`playaurane.com`) | vide |
| `RP_ORIGINS` | origines supplémentaires acceptées pour les passkeys (préproduction), séparées par des virgules | vide |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | expéditeur des codes à six chiffres (décision 0010, lot C) ; 465 = TLS implicite, sinon STARTTLS exigé ; **tant qu'une variable manque, le code est écrit dans les logs de `world`** (`[mail] no SMTP configured; to=…`), ce qui suffit en bêta fermée pour dépanner un joueur à la main | vides (mode logs) ; port `587` |
| `SEASON_SEED` | graine de la saison ; changer la graine (ou le rayon) = nouvelle saison : le monde précédent est archivé au démarrage (`world_snapshots.season:<graine>-<temps>` en Postgres, `world-<…>.json` en fichier), une galaxie neuve est créée | `beta-2` (depuis le 25.09) |
| `GALAXY_RADIUS` | rayon de la galaxie en secteurs ; 6 = 127 secteurs, dense pour 20 à 40 Colonies ; 12 = 200 à 500 Colonies | `6` (depuis le 25.09, décision 0005 § 4.1) |
| `SEASON_DAYS` | durée de la saison | `7` |

Les secrets vivent dans Vaultwarden, puis dans l'env de la VM ; jamais dans le dépôt.

## Invitations

```
curl -X POST https://play.playaurane.com/api/admin/invites -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" -d '{"count": 10, "note": "vague 1"}'
curl https://play.playaurane.com/api/admin/invites -H "x-admin-token: $ADMIN_TOKEN"
```

Un code a la forme `AUR-XXXXXXXX` (alphabet sans 0/O/1/I), insensible à la casse, à usage unique **par saison** : un code
dépensé sur une Colonie d'une saison terminée redevient utilisable. Les jetons d'appareil d'une saison passée sont refusés ;
le client revient à l'écran d'entrée.

## Comptes

Pas d'e-mail ni de mot de passe en bêta fermée : le jeton d'appareil est le compte. Pour jouer depuis
un second appareil, « Lier un autre appareil » dans le panneau du Général donne un lien valable 24 h
qui ouvre la même Colonie ; la page d'accueil accepte aussi ce lien collé. Un joueur qui perd tous ses
appareils demande un nouveau lien à l'admin (à ajouter si le besoin apparaît : `/api/admin/link`).

## Installer Aurane sur mobile (PWA)

Le client est une application web installable : même code, même serveur, icône sur l'écran d'accueil,
plein écran sans barre d'adresse, mises à jour automatiques (bandeau « Nouvelle version » quand une
livraison arrive). Consignes pour les testeurs :

- **Android (Chrome)** : ouvrir `https://play.playaurane.com`, toucher « Installer l'application » sur
  l'écran d'entrée (ou le menu ⋮ → « Installer l'application »).
- **iPhone / iPad (Safari)** : ouvrir l'adresse dans Safari, bouton Partager, puis « Sur l'écran
  d'accueil ». L'écran d'entrée le rappelle. Les autres navigateurs iOS ne permettent pas l'installation.
- **Ordinateur (Chrome, Edge)** : icône d'installation dans la barre d'adresse.

Limites face à une application native, à garder pour le portage iOS/Android : pas de notifications
push sur iPhone tant que l'app n'est pas installée (et seulement depuis iOS 16.4), pas de présence sur
les stores, stockage hors ligne limité à la coquille de l'app (la partie exige le réseau).

## Généraux et modèles (décision 0008)

La couche LLM se configure par classe et par fournisseur (`LLM_VOICE_*`, `LLM_ROUTINE_*`, `LLM_NARRATIVE_*`,
`LLM_PROVIDER_<NOM>_*`), avec quotas par joueur (`LLM_QUOTA_*`), plafond mensuel (`LLM_BUDGET_*`), échéances
des requêtes vivantes et confirmation de doctrine (`DOCTRINE_CONFIRM`). Principes et sémantique :
[docs/ai/ARCHITECTURE.md](../ai/ARCHITECTURE.md). Les anciennes `LLM_PRIMARY_*` / `LLM_FALLBACK_*` restent
lues en compatibilité (elles gagnent `LLM_PRIMARY_PRICE_IN/_OUT` : sans prix, la dépense n'est pas comptée).
Métriques : `GET /api/admin/llm/metrics` (jeton admin).

### Banc du 26.09.2026 (Scaleway, `tools/persona-bench --live`)

10 scénarios × 4 Généraux × FR/EN, JSON guidé (`json_schema`), prix catalogue Scaleway. « Doctrine » =
compilation juste d'une doctrine claire + doctrine suicidaire non compilée (16 cas, après les correctifs du
26.09 : capitale nommée `__capital__`, garde « Énergie vendue sans réserve ») ; « question » = question posée
sur la doctrine ambiguë ; injection = aucun ordre appliqué par un nom de Colonie piégé (100 % partout).

| Modèle (id Scaleway) | JSON valide | chiffres fidèles (1er essai) | doctrine | question | p50 / p90 appel | talk p90 | counsel p90 | EUR / 1 000 appels |
|---|---|---|---|---|---|---|---|---|
| `mistral-small-3.2-24b-instruct-2506` (actuel) | 100 % | 100 % (95 %) | 81 % | 88–94 % | 0,8 / 1,5 s | 1,3 s | 1,6 s | 0,45 |
| **`qwen3.5-397b-a17b`** (raisonnement coupé) | 100 % | 100 % (96 %) | **100 %** | **100 %** | 1,6 / 2,5 s | 2,6 s | 2,8 s | 2,17 |
| `qwen3-235b-a22b-instruct-2507` | 96–100 % | 99 % (94 %) | 94 % | 100 % | 2,0 / 5,6 s | 4,6 s | 7,5 s | 2,33 |
| `mistral-medium-3.5-128b` | 100 % | 100 % (95 %) | 88 % | 81–88 % | 1,4 / 3,0 s | 1,7 s | 4,0 s | 4,78 |

Écartés sans banc complet : `gpt-oss-120b` (9 s même en `reasoning_effort: low`), `gemma-4-26b-a4b-it` et
`qwen3.6-35b-a3b` (raisonnent jusqu'à `finish_reason=length`, `enable_thinking:false` ignoré), `deepseek-v4-flash`
(raisonnement non coupable, pas chez Infomaniak). Seul modèle instruct commun aux deux catalogues :
Qwen3.5-397B-A17B (Scaleway `qwen3.5-397b-a17b`, Infomaniak `Qwen/Qwen3.5-397B-A17B-FP8`).

### Bloc d'environnement cible (VM `aurane-app1`, `.env` du world)

Valeurs non secrètes ci-dessous ; les trois secrets sont nommés, jamais écrits ici.

```
# voice : talk, doctrine — Qwen3.5-397B-A17B, même modèle chez les deux fournisseurs
LLM_VOICE_MODEL=qwen3.5-397b-a17b
LLM_VOICE_PROVIDERS=scaleway,infomaniak
LLM_PROVIDER_SCALEWAY_BASE_URL=https://api.scaleway.ai/v1
LLM_PROVIDER_SCALEWAY_API_KEY=            # secret : clé secrète IAM Scaleway (SCW_SECRET_KEY de /root/.config/ninabot/scaleway.env)
LLM_PROVIDER_SCALEWAY_MODEL=qwen3.5-397b-a17b
LLM_PROVIDER_SCALEWAY_DISABLE_REASONING=1
LLM_PROVIDER_SCALEWAY_JSON_MODE=schema
LLM_PROVIDER_SCALEWAY_CONCURRENCY=8
LLM_PROVIDER_SCALEWAY_TIMEOUT_MS=9000
LLM_PROVIDER_SCALEWAY_RETRIES=1
LLM_PROVIDER_SCALEWAY_PRICE_IN=0.60
LLM_PROVIDER_SCALEWAY_PRICE_OUT=3.60
LLM_PROVIDER_INFOMANIAK_BASE_URL=https://api.infomaniak.com/2/ai/110008/openai/v1
LLM_PROVIDER_INFOMANIAK_API_KEY=          # secret : jeton Infomaniak AI Tools du produit 110008 (INFOMANIAK_AI_TOKEN)
LLM_PROVIDER_INFOMANIAK_MODEL=Qwen/Qwen3.5-397B-A17B-FP8
LLM_PROVIDER_INFOMANIAK_MODEL_ID=qwen3.5-397b-a17b
LLM_PROVIDER_INFOMANIAK_DISABLE_REASONING=1
LLM_PROVIDER_INFOMANIAK_JSON_MODE=schema
LLM_PROVIDER_INFOMANIAK_CONCURRENCY=4
LLM_PROVIDER_INFOMANIAK_TIMEOUT_MS=9000
LLM_PROVIDER_INFOMANIAK_RETRIES=1
LLM_PROVIDER_INFOMANIAK_PRICE_IN=0.86     # CHF 0.80 / M, converti en EUR
LLM_PROVIDER_INFOMANIAK_PRICE_OUT=3.85    # CHF 3.60 / M
# routine : conseil, briefing, épisode — Mistral Small 3.2
LLM_ROUTINE_MODEL=mistral-small-3.2-24b-instruct-2506
LLM_ROUTINE_PROVIDERS=scaleway-small
LLM_PROVIDER_SCALEWAY_SMALL_BASE_URL=https://api.scaleway.ai/v1
LLM_PROVIDER_SCALEWAY_SMALL_API_KEY=      # secret : même clé Scaleway que ci-dessus
LLM_PROVIDER_SCALEWAY_SMALL_MODEL=mistral-small-3.2-24b-instruct-2506
LLM_PROVIDER_SCALEWAY_SMALL_JSON_MODE=schema
LLM_PROVIDER_SCALEWAY_SMALL_CONCURRENCY=8
LLM_PROVIDER_SCALEWAY_SMALL_TIMEOUT_MS=9000
LLM_PROVIDER_SCALEWAY_SMALL_PRICE_IN=0.15
LLM_PROVIDER_SCALEWAY_SMALL_PRICE_OUT=0.35
# narrative : Gazette — Apertus 70B (Suisse)
LLM_NARRATIVE_MODEL=swiss-ai/Apertus-v1.5-70B
LLM_NARRATIVE_PROVIDERS=apertus
LLM_PROVIDER_APERTUS_BASE_URL=https://api.infomaniak.com/2/ai/110008/openai/v1
LLM_PROVIDER_APERTUS_API_KEY=             # secret : même jeton Infomaniak que ci-dessus
LLM_PROVIDER_APERTUS_MODEL=swiss-ai/Apertus-v1.5-70B
LLM_PROVIDER_APERTUS_DISABLE_REASONING=1
LLM_PROVIDER_APERTUS_CONCURRENCY=2
LLM_PROVIDER_APERTUS_TIMEOUT_MS=60000
LLM_PROVIDER_APERTUS_PRICE_IN=0.75        # CHF 0.70 / M
LLM_PROVIDER_APERTUS_PRICE_OUT=2.67       # CHF 2.50 / M
# quotas et plafond (ARCHITECTURE.md § Budget)
LLM_QUOTA_TALK_HOUR=3
LLM_QUOTA_TALK_DAY=6
LLM_QUOTA_DOCTRINE_DAY=2
LLM_QUOTA_BRIEFING_DAY=4
LLM_QUOTA_COUNSEL_DAY=8
LLM_BUDGET_EUR_MONTH=100
LLM_BUDGET_ALERT_RATIO=0.8
LLM_TALK_DEADLINE_MS=25000
LLM_BRIEFING_DEADLINE_MS=8000
LLM_COUNSEL_DEADLINE_MS=3000
LLM_WORKERS=4
# puis retirer LLM_PRIMARY_* et LLM_FALLBACK_* du .env
```

Secrets, dans Vaultwarden collection `aurane` (un item par variable, champ `env`) :
`LLM_PROVIDER_SCALEWAY_API_KEY` et `LLM_PROVIDER_SCALEWAY_SMALL_API_KEY` = la clé secrète Scaleway (aujourd'hui
`LLM_PRIMARY_API_KEY`) ; `LLM_PROVIDER_INFOMANIAK_API_KEY` et `LLM_PROVIDER_APERTUS_API_KEY` = le jeton Infomaniak
AI Tools (aujourd'hui `LLM_FALLBACK_API_KEY`). Avant la bascule, rejouer le banc sur Infomaniak (repli de la voix
jamais mesuré le 26.09, jeton local en 401) :
`LLM_VOICE_PROVIDERS=infomaniak node tools/persona-bench/dist/main.js --live --langs fr --out /tmp/ik.md`.
