# Contexte ninabot pour StarNet

> Rassemblé le 24 septembre 2026 depuis la mémoire ninabot (corthexis / sokkan-memory) et vérifié
> sur les machines. **Aucun secret ici** : les valeurs vivent dans Vaultwarden, ce document dit
> seulement où. Les adresses internes (tailnet, IP) sont volontairement omises ; les hôtes se
> nomment par leur nom de machine.

---

## 1. Exoscale — partenariat ISV

- **Organisation Exoscale** : `Ninabot sàrl` (contrat ISV signé été 2026, plus VAP ; zéro
  engagement de volume, zéro exclusivité). Facturation sur facture mensuelle depuis juillet 2026.
- **Crédit** : **250 CHF/mois d'usage offert** (« for testing your solution ») + remise par paliers
  (7 % → 12/15 %) sur la consommation propre. Burn constaté début septembre ≈ 140 CHF/mois pour
  cinq VMs `standard.medium`/`small` (démo SOKKAN, frontal web, standby Postgres, backend DR
  dormant, runner MAIC). **Marge disponible ≈ 100 CHF/mois**, soit deux à trois VMs d'essai. Un
  cluster SKS + DBaaS + Valkey dépasse cette marge : StarNet Saison 0 démarre sur le crédit pour la
  préprod, et bascule en facturé (remise ISV) au passage en bêta. Ne jamais qualifier de « test »
  ce qui est de la production dans un échange avec Exoscale.
- **Zone préférée** : **`ch-gva-2`** (Genève). Toutes les VMs de production y sont, le chemin
  Tailscale vers rog1 y est direct (~2–5 ms), et c'est l'argument souveraineté. `ch-dk-2` (Zürich)
  n'a servi qu'au module ninjob « B-lean » dormant.
- **Quota GPU** : 0 instance GPU autorisée sur l'org (relance en cours). Ne pas compter sur un GPU
  Exoscale ; l'inférence reste sur rog1.
- Toute communication publique citant Exoscale = approbation écrite mutuelle (clause du contrat).
- **Suivi API** : si une clé Exoscale « ne marche plus », regarder d'abord `exoscalestatus.com`,
  puis vérifier le profil CLI (`exo` lit `~/.config/exoscale/exoscale.toml`, le provider Terraform
  lit `EXOSCALE_API_KEY` / `EXOSCALE_API_SECRET` dans l'environnement — ce ne sont pas les mêmes
  fichiers).

### Conventions Terraform (déjà en place)

Deux modules existent, à copier plutôt qu'à réinventer :

| Module | Dépôt | Ce qu'il provisionne |
|---|---|---|
| `infra/exoscale/` | ninabot-pro | Instance `cpu.mega`, DBaaS PostgreSQL 16 + pgvector (`business-8`, HA), DBaaS Valkey (`business-1`), privnet, security group deny-all, bucket SOS via provider AWS. Dormant (jamais appliqué), mais `plan` propre. |
| `sokkan-env/` | sokkan-cloud (privé) | 1 VM par client + addons + DBaaS optionnelle, un privnet par client, cloud-init (docker → tailscale → release → compose → cloudflared), un workspace Terraform par client, tfvars JSON générés. Appliqué en prod des dizaines de fois. |

Règles tirées de ces modules :

- `terraform >= 1.6`, providers `exoscale/exoscale ~> 0.64`, `hashicorp/cloudinit ~> 2.3`,
  `hashicorp/aws ~> 5.0` (SOS est S3-compatible, il n'y a pas de ressource SOS native ; endpoint
  `https://sos-<zone>.exo.io`, `skip_*` sur le provider AWS).
- **Credentials par l'environnement**, jamais dans les `.tf` ni les tfvars commités
  (`terraform.tfvars` gitignored ; le README du module documente le chargement depuis Vaultwarden
  en début de session).
- **Clé API scopée** : rôle IAM Exoscale least-privilege (`default-deny`, seulement les services
  utilisés, aucune permission org-level). Créer un rôle et une clé dédiés à StarNet sur ce modèle,
  stockés dans Vaultwarden.
- **Security group deny-all ingress** ; SSH par Tailscale (`tailscale up --ssh`), entrée web par
  tunnel Cloudflare (connexion sortante). Seul UDP 41641 ouvert pour le chemin direct Tailscale.
- **cloud-init** installe docker, tailscale (clé d'enrôlement éphémère taguée, frappée via l'API
  tailnet, 1 h, usage unique), cloudflared (token créé via l'API Cloudflare). `user_data` en
  `lifecycle { ignore_changes }` : un changement de cloud-init ne doit jamais remplacer une VM.
- **State** : local par défaut (module inerte dans le dépôt) ; en prod le state est copié vers un
  bucket SOS. Bloc `backend "s3"` prêt en commentaire dans `versions.tf` ; passer en backend
  distant seulement quand deux hôtes doivent piloter le state.
- **`termination_protection = true`** sur les DBaaS (garde-fou voulu : `destroy` échoue).
- Pièges vécus : l'API refuse de rétrécir un pool DHCP de privnet ; la description d'un SG est
  immuable (= replace) ; l'attribut `uri` d'une DBaaS reste `null` côté provider, il faut
  `exo dbaas show --uri` ; sous systemd, `exo` a besoin de `HOME` et d'un `PATH` explicite ; les IP
  CGNAT Tailscale n'atteignent pas l'endpoint public d'une DBaaS (allowlister l'IP publique).
- Convention de nommage des VMs : `<projet>-<rôle><n>` (`ninabot-front1`, `ninjob-dr1`,
  `maic-runner1`). Pour StarNet : `starnet-<rôle>1`. Label `role=<…>` sur l'instance.
- VMs Exoscale naissent en UTC : passer `Europe/Zurich` avant tout timer.
- Il n'y a **pas encore de SKS** chez ninabot : StarNet serait le premier cluster Kubernetes managé.
  Le GDD tranche pour SKS ; la mémoire ne contredit rien, mais tout ce qui existe est « une VM +
  docker compose + tunnel ». Prévoir que le premier `exoscale_sks_cluster` essuie les plâtres.

---

## 2. rog1 — inférence LLM maison

- **Nom dans le tailnet** : `rog1` (MagicDNS actif, donc `rog1` résout depuis tout nœud du
  tailnet ; les `/etc/hosts` des hôtes ninabot le résolvent aussi). Ubuntu Server 24.04,
  i9-9980XE, 64 Go, **4× Intel Arc Pro B60 (96 Go VRAM)**, stack XPU (pas CUDA).
- **Endpoints, tous OpenAI-compatibles (`/v1/chat/completions`, `/v1/models`)**, vérifiés vivants
  le 24.09.2026 :

| Port | Modèle | Serveur | Cartes | Notes |
|---|---|---|---|---|
| 8003 | `gpt-oss-20b` | vLLM-XPU (TP=1) | 1 | contexte 65k ; flags `--reasoning-parser openai_gptoss` + `--tool-call-parser openai` obligatoires ensemble, sinon `content=None` avec 200 OK |
| 8006 | `qwen3-coder-30b` | llama.cpp (GGUF) | — | contexte 32k |
| **8007** | **`qwen3-next-80b`** | llama.cpp (GGUF UD-Q3_K_XL) | 2 (cartes 2+3) | **MoE 80B / 3B actifs, ~36 tok/s**, contexte 32k — c'est le candidat « Général » (recommandation §9.3 du GDD) |
| 11434 | phi4:14b, qwen2.5:7b | ollama | aucune (CPU) | 40–120 s par réponse, inutilisable en prod |

- **Mode d'auth : aucun.** Les serveurs écoutent sur l'interface Tailscale de rog1 et sur
  loopback, sans clé API. La sécurité est l'ACL du tailnet : les VMs Exoscale portent un tag
  (`tag:ninabot-infra`) dont le grant vers rog1 est limité à une liste de ports, dont 8007 ; un
  nœud tagué ne joint rien d'autre. Pour StarNet, préférer un tag dédié `tag:starnet` avec un
  grant limité à `rog1:8007` (le tag partagé donne aussi accès à d'autres services du groupe).
- **Limites mesurées** : llama.cpp sans continuous batching → le 80B sert **~2 utilisateurs
  simultanés** ; le budget GDD (18 M tokens/jour) impose une file de jobs et des quotas, pas des
  appels synchrones. `reasoning_effort: "low"` sur gpt-oss ramène un appel à ~2 s. Un `max_tokens`
  serré tronque un modèle qui raisonne avant son JSON.
- **Sorties structurées** : demander le JSON dans le prompt et nettoyer les fences en sortie ;
  ne pas compter sur `response_format` (llama.cpp le supporte partiellement, Infomaniak l'a
  retiré, voir §3).
- vLLM tourne en `restart: "no"` depuis des emballements RAM en TP=2/4 ; le 8003 peut donc être
  absent après un reboot. Le 8007 est la cible à privilégier.
- **Accès depuis une session cloud** : rien n'est exposé sur Internet. Options (non encore
  câblées) : Tailscale Funnel sur rog1 devant le 8007 avec jeton, ou Cloudflare Tunnel + Access
  avec service token. En attendant, développer contre Infomaniak.
- Avant toute expérience GPU sur rog1 : énumérer ce qui tourne (`clinfo -l`, `docker ps`), c'est
  la prod ninjob/payeh/SOKKAN qui partage la machine. Fenêtres de maintenance :
  `infra/maintenance/maintenance.sh on|off` (ninabot-pro).

---

## 3. Repli Infomaniak

- **Produit** : Infomaniak **AI Tools** (API OpenAI-compatible, hébergée en Suisse), un produit
  partagé par tout le groupe (ninjob, OpenClaw/NinaPro, SOKKAN `sokkan-swiss`, MAIC, Nina QA).
  Base URL de la forme `https://api.infomaniak.com/2/ai/<product_id>/openai/v1` (l'endpoint
  `/1/ai/…` est l'ancienne forme, à ne plus utiliser). Le jeton et l'id produit sont dans
  Vaultwarden.
- **Catalogue LLM au 24.09.2026** (`GET /v1/models`) :

| Modèle | Paramètres | ≤ 80B |
|---|---|---|
| `swiss-ai/Apertus-v1.5-70B` | 70B dense, entraîné en Suisse (EPFL/ETHZ) | ✅ |
| `google/gemma-4-31B-it` | 31B dense | ✅ |
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8` | 30B MoE, 3B actifs | ✅ |
| `mistralai/Ministral-3-14B-Instruct-2512` | 14B dense | ✅ |
| `Qwen/Qwen3.5-122B-A10B-FP8` | 122B MoE, 10B actifs | ❌ (total) |
| `mistralai/Mistral-Small-4-119B-2603` | 119B | ❌ |
| `moonshotai/Kimi-K2.6` | ~1T MoE | ❌ |
| `Qwen/Qwen3.5-397B-A17B-FP8` | 397B MoE | ❌ |

  Plus embeddings (`Qwen/Qwen3-Embedding-8B`, `bge_multilingual_gemma2`, `mini_lm_l12_v2`),
  rerankers, Whisper, Flux.
  Recommandation repli StarNet : **`Apertus-v1.5-70B`** (souverain, dense, bon en français) ou
  **`Nemotron-3-Nano-30B-A3B`** (MoE rapide, profil proche du qwen3-next-80b de rog1). Kimi-K2.6
  est le primaire du groupe pour tout le reste, mais dépasse le plafond 80B fixé par le GDD.
- **Divergences de la passerelle Infomaniak (mesurées, corrigées ailleurs dans le groupe)** :
  - `response_format: {"type":"json_object"}` → **400** depuis le 21.09.2026 ; utiliser
    `{"type":"json_schema","json_schema":{"name":"…","schema":{…}}}` (`name` obligatoire), ou
    demander le JSON dans le prompt et retirer les fences.
  - Pour couper le raisonnement : **`reasoning_effort: "none"`** (les formes `thinking` /
    `enable_thinking` sont ignorées). Sans ça, le raisonnement consomme tout `max_tokens` et
    `content` revient vide avec `finish_reason=length`.
  - Le champ de raisonnement s'appelle `reasoning` (pas `reasoning_content`).
- Tarifs catalogue plus chers que Scaleway/OVH (≈ 1,00/1,50 CHF par Mtok) — c'est le prix de
  « jamais hors CH ». Cohérent avec §9.3 du GDD (doctrines des joueurs = données personnelles,
  rog1 ou Infomaniak seulement).

---

## 4. Vaultwarden

- **Instance** : Vaultwarden auto-hébergée sur gmk1 (derrière Cloudflare), compte propriétaire
  unique de ninabot, TOTP natif. Sauvegarde quotidienne vers R2.
- **Organisation du coffre** : **un seul compte, des dossiers personnels** (pas d'Organisation
  Bitwarden à ce jour). Dossiers : `ninabot` (tous les services du groupe) et, depuis le
  24.09.2026, **`starnet`** (créé, vide). Convention de nommage des éléments :
  `ninabot/<service>` ou `<service>-<usage>` ; les secrets multiples d'un même service vont en
  **champs personnalisés**, pas dans les notes.
  Éléments existants utiles à StarNet (à lire, pas à dupliquer) : `exoscale-api` (clé scopée +
  zone par défaut), `ninabot/tailscale` (jeton API tailnet, expire début novembre 2026, à
  renouveler par Nick), `ninabot/cloudflare`, `ninabot/cloudflare-r2`, l'élément Infomaniak AI.
- **Convention StarNet** (attendue par le hook de `docs/ops/access.md`) : un élément par variable,
  dans le dossier `starnet`, avec un champ personnalisé **`env`** = nom de la variable
  (`LLM_PRIMARY_BASE_URL`, `LLM_PRIMARY_API_KEY`, `LLM_PRIMARY_MODEL`, `LLM_FALLBACK_*`,
  `EXOSCALE_API_KEY`, `EXOSCALE_API_SECRET`, `CLOUDFLARE_API_TOKEN`, `TS_API_TOKEN`…).
- **Accès CLI (procédure du groupe)** : `bw config server` → `bw login --apikey` → `bw unlock`
  (mot de passe maître obligatoire, la clé API ne suffit pas) → `BW_SESSION` → `bw sync` →
  opérations → `bw lock`. Sous systemd, **toujours `Environment=HOME=/root`** (sinon `bw` ouvre un
  profil vide et répond « unauthenticated » sans erreur — panne muette vécue trois fois). Les
  éléments anciens chiffrés en AES-CBC refusent de se déchiffrer avec un `bw` récent : re-sauver
  l'élément dans l'UI web.
- **Compte de service en lecture seule — ce qu'il faut savoir** : un **dossier** Bitwarden est
  personnel et ne se partage pas ; « lecture seule sur `starnet` » n'est possible qu'avec une
  **Organisation** et une **Collection**. Marche à suivre (UI web, une fois, côté Nick) : créer
  une Organisation `ninabot` depuis le compte propriétaire (gratuite et illimitée sur
  Vaultwarden), créer la collection `starnet` et y placer les éléments StarNet, inviter un
  utilisateur dédié avec le rôle User et un accès **Read only** limité à cette collection, puis
  confirmer l'invitation. Ce compte dédié fournit au hook ses identifiants CLI et son mot de passe
  maître, placés dans les variables de l'environnement cloud, jamais dans le dépôt. Révocation =
  retirer l'utilisateur de l'organisation. Tant que l'organisation n'existe pas, le hook ne peut
  lire le dossier `starnet` qu'avec le compte propriétaire, qui est le compte à tout faire du
  groupe : à réserver au poste de Nick.
- **Règle groupe** : jamais un secret dans un dépôt, un log ou une sortie de session ; toute
  valeur lue en clair dans une session est à faire tourner.

---

## 5. Observabilité et CI/CD en place

### Observabilité (gmk1, Docker)

| Composant | Version | Rôle |
|---|---|---|
| Prometheus | 2.55 | TSDB, rétention 15 j, scrape node-exporter (gmk1, rog1, les VMs Exoscale via Tailscale), cAdvisor, exporters maison (textfile collector, timers Python) |
| Grafana OSS | 11.3 | dashboards par dossier (`infra`, `sales`, `Produits`), **alertes provisionnées par fichier** (`provisioning/alerting/*.yml`) routées vers **Telegram** par label `area=…` (⚠️ tout nouveau label `area` doit avoir sa route dans la notification policy, sinon l'alerte part dans le vide) |
| Loki 3.2 + Promtail | — | logs des conteneurs Docker (gmk1 et rog1) |
| Uptime Kuma 1.23 | — | sondes HTTP externes + alertes Telegram |
| Umami | 2.15 | analytics web (RUM, funnels) pour les sites publics |
| node-exporter / cAdvisor | 1.8 / 0.52 | métriques hôte et conteneurs |

- **Pas de Tempo, pas de collecteur OpenTelemetry** à ce jour : StarNet peut envoyer métriques
  Prometheus (endpoint `/metrics` scrapé par le tailnet) et logs Promtail vers la pile existante ;
  le tracing OTLP demanderait d'ajouter Tempo (ou Grafana Alloy) — à décider, le GDD §12.1 laisse
  le choix.
- Pattern à copier pour un nouvel hôte : node-exporter lié à l'interface Tailscale, job `node`
  dans Prometheus avec label `host=`, alertes `InfraDiskFull` (> 85 %, 15 min) et `InfraNodeDown`
  déjà génériques. Timer `docker-prune` quotidien sur chaque VM (incident disque 99 % vécu).
- Grafana est derrière Cloudflare Access + Authentik (WebAuthn) ; accès mobile par Tailscale.

### CI/CD (depuis le 19.09.2026)

- **Forge centrale = Forgejo 11 auto-hébergé sur rog1** (`git.ninabot.ch`, org `ninabot`,
  derrière Cloudflare Access ; registre d'images intégré). **GitHub et GitLab sont des miroirs**
  (double push depuis les clones locaux, jusqu'à ~mi-octobre). StarNet vit aujourd'hui sur GitHub
  (`nicolas-micaud/starnet`) : la convention groupe voudrait un dépôt `ninabot/starnet` sur la
  forge avec GitHub en miroir. À trancher avec Nick ; en attendant GitHub Actions est acceptable
  pour lint + tests (un `.github/workflows/ci.yml` existe déjà sur le dépôt public sokkan).
- **Runner** : `act_runner` sur rog1 (Forgejo Actions, syntaxe GitHub Actions) avec un
  `docker:27-dind` isolé ; labels `runs-on: python` (image Python 3.12 sans node → clone manuel
  au lieu de `actions/checkout`) et `runs-on: docker`. Le registre refuse les couches > 100 Mo via
  Cloudflare : on **pousse par le tailnet**, on tire par `git.ninabot.ch`.
- **Pipeline type** : push `main` → `lint` (py_compile, harnais e2e hors réseau, marqueurs de
  conflit) → `images` taguées `<sha>` → `deploy-staging` (stack `stg-<projet>` sur rog1 + smoke)
  → **promotion manuelle** `scripts/promote.sh <cible> [tag]` (gate humaine, lancée depuis une
  session ou par Nick) → prod. Préprod par branche : tout push sur une branche ≠ `main` déploie
  une stack complète sous `preprod.ninabot.ch/<branche>/`.
- **Déploiement sur les hôtes** : utilisateur `deploy` à shell restreint sur chaque cible,
  `docker compose --env-file .env --env-file .deploy.env pull && up`, sondes, rollback au tag
  précédent. Prod = `deploy/docker-compose.yml` + `promote.sh` uniquement ; un
  `docker-compose.dev.yml` séparé pour le dev local.
- Pour StarNet en SKS, le pattern « promote = `kubectl apply` d'un tag » reste à écrire ; garder
  la gate humaine avant prod et le tag `<sha>` sur les images.

---

## 6. Conventions de code et de dépôt ninabot

Il n'y a **pas de monorepo pnpm** chez ninabot : ni `pnpm` installé, ni `pnpm-workspace.yaml`
nulle part. Le GDD §12.2 propose un monorepo `packages/*` pour StarNet ; c'est une première pour
le groupe, à assumer comme telle (npm workspaces suffit et évite un outil de plus sur les
runners — `node 22` et `npm 10` sont ce qui tourne).

Ce qui est constant dans les dépôts existants :

- **Un dépôt par produit**, extrait de `ninabot-pro` dès qu'il a une prod (`whoistheboss`,
  `maic`, `nakisa-site`, `sokkan`). `ninabot-pro` reste le dépôt infra/ops (Terraform, compose,
  runbooks, mémoire). StarNet a déjà son dépôt : cohérent.
- **`CLAUDE.md` à la racine** = contrat de session (contexte, règles, commandes), lu par tous
  les agents. **Docs de design en français, code et commits en anglais** (règle déjà dans le
  CLAUDE.md de StarNet, identique au groupe).
- **Commits** : `type: description courte` avec `feat`, `fix`, `config`, `docker`, `docs`,
  `chore` (+ un scope entre parenthèses quand c'est utile : `fix(linkedin): …`). Commit après
  chaque changement significatif, push dans la foulée.
- **Bilingue FR/EN** dès le départ sur tout ce qui est public (sites, mails, UI) ; `i18n` par
  dictionnaires, pas de service externe.
- **JS/TS** : ESM (`"type": "module"`), TypeScript strict quand il y a un build (Next.js sur
  ninjob, Astro sur les vitrines), `eslint` avec `react/no-unescaped-entities` en **error** (les
  apostrophes françaises dans le JSX cassent le build — piège vécu quatre fois), tests `vitest`
  ou `node --test` (StarNet). Pas de Prettier imposé.
- **Python** : 3.12, `ruff` (line-length 100), FastAPI + uvicorn, tests par harnais e2e hors
  réseau lancés en CI.
- **Docker partout** : une image par service, compose par environnement, `restart: unless-stopped`
  en prod, ports liés sur loopback ou interface Tailscale (jamais `0.0.0.0` sur un hôte exposé),
  entrée publique uniquement par tunnel Cloudflare.
- **Secrets** : `.env` gitignored, jamais rsyncé, chargé depuis Vaultwarden au déploiement ; un
  placeholder dans une commande = arrêt, pas de valeur inventée.
- **Déterminisme et tests** : toute logique métier testée sans réseau (StarNet : `npm test`
  sur la simulation) ; la CI mesure le produit réel, pas une version dégradée.
- **Mémoire** : les décisions et pièges vont dans une note de mémoire (corthexis) avec une
  `description:` soignée ; un chantier sans note n'existe pas. Pour StarNet, `docs/` joue ce
  rôle tant que la mémoire n'est pas branchée (cf. `docs/ops/access.md`).
- **Vérifier la chose écrite** : après un déploiement, une sonde réelle (curl, navigateur), pas
  une déduction.

---

## 7. Ce qui manque encore (à ouvrir avec Nick)

1. Rôle + clé IAM Exoscale scopés `starnet` (compute, sks, dbaas, sos) → Vaultwarden `starnet`.
2. Tag Tailscale `tag:starnet` avec grant `rog1:8007` seul ; clé d'enrôlement frappée par l'API.
3. Organisation Vaultwarden + collection `starnet` + compte de service lecture seule (§4).
4. Exposition du 8007 pour les sessions cloud (Funnel ou Tunnel + Access).
5. Dépôt `ninabot/starnet` sur la forge (miroir GitHub) ou GitHub Actions assumé.
6. Budget : SKS + DBaaS + Valkey ≈ 150–250 CHF/mois au-delà du crédit → validation avant `apply`.
