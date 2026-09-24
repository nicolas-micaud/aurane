# Contexte ninabot pour Aurane (ex StarNet)

> **Renommage 24.09.2026** : le jeu s'appelle **Aurane** (StarNet est trop proche d'autres jeux) ; domaine
> cible `playaurane.com` (achat en cours par une autre session). Les noms techniques ci-dessous suivent :
> collection Vaultwarden `aurane`, rôle IAM `terraform-aurane`, tag Tailscale `tag:aurane`.
>
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
- **Clé API scopée — FAIT le 24.09** : rôle IAM `terraform-aurane` (`default-deny`, services `compute`,
  `dbaas`, `sos` autorisés, aucune permission org-level ; validé à chaud : compute/dbaas OK, iam/dns
  refusés) et clé API du même nom. Dans la collection Vaultwarden `aurane` : items
  `exoscale-aurane-api-key` (`env=EXOSCALE_API_KEY`) et `exoscale-aurane-api-secret`
  (`env=EXOSCALE_API_SECRET`), valeur dans `login.password`. Pas de `sks` dans le rôle : la Saison 0
  est en VM + Compose ; à élargir le jour où SKS revient.
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
  `maic-runner1`). Pour Aurane : `aurane-<rôle>1`. Label `role=<…>` sur l'instance.
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
  nœud tagué ne joint rien d'autre. **Aurane a son tag dédié depuis le 24.09 : `tag:aurane`**,
  grant limité à `rog1:8007`, SSH ops depuis les devices membres, et un test d'ACL qui refuse
  gmk1:22, rog1:22, rog1:5432, rog1:8003 et la forge (Tailscale exécute ces tests à chaque
  enregistrement de la politique). Une clé d'enrôlement se frappe par l'API tailnet
  (`tags:["tag:aurane"]`, éphémère, 1 usage) au moment de créer la VM.
- **Limites mesurées** : llama.cpp sans continuous batching → le 80B sert **~2 utilisateurs
  simultanés** ; le budget GDD (18 M tokens/jour) impose une file de jobs et des quotas, pas des
  appels synchrones. `reasoning_effort: "low"` sur gpt-oss ramène un appel à ~2 s. Un `max_tokens`
  serré tronque un modèle qui raisonne avant son JSON.
- **Sorties structurées** : demander le JSON dans le prompt et nettoyer les fences en sortie ;
  ne pas compter sur `response_format` (llama.cpp le supporte partiellement, Infomaniak l'a
  retiré, voir §3).
- vLLM tourne en `restart: "no"` depuis des emballements RAM en TP=2/4 ; le 8003 peut donc être
  absent après un reboot. Le 8007 est la cible à privilégier.
- **Accès depuis une session cloud** : rien n'est exposé sur Internet pour le LLM. Options (non encore
  câblées) : Tailscale Funnel sur rog1 devant le 8007 avec jeton, ou Cloudflare Tunnel + Access
  avec service token. En attendant, développer contre Infomaniak.
- **La mémoire ninabot, elle, est joignable** depuis le 24.09.2026 : MCP `sokkan-memory`
  (`memory_search`, `memory_get`, lecture seule) en streamable-HTTP sur `https://memory.ninabot.ch/mcp`,
  jeton Bearer applicatif (`SOKKAN_MEMORY_MCP_TOKEN`, collection Vaultwarden `aurane`), `/healthz`
  sans jeton. Pas de Cloudflare Access devant : un connecteur MCP ne sait pas présenter un service
  token. Config Claude Code : `{"type":"http","url":"https://memory.ninabot.ch/mcp","headers":{"Authorization":"Bearer ${SOKKAN_MEMORY_MCP_TOKEN}"}}`.
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
- **Organisation du coffre** (état au 24.09.2026, après-midi) : le compte propriétaire garde ses
  dossiers personnels (`ninabot` pour tout le groupe, `aurane` pour les références côté propriétaire),
  et une **Organisation Bitwarden `ninabot`** existe désormais avec la **collection `aurane`**. C'est
  la collection que lit le hook cloud. Convention de nommage des éléments : `ninabot/<service>` ou
  `<service>-<usage>` ; les secrets multiples d'un même service vont en **champs personnalisés**, pas
  dans les notes.
- **Convention StarNet** (attendue par le hook de `docs/ops/access.md`) : un élément par variable,
  dans la collection `aurane`, avec un champ personnalisé **`env`** = nom de la variable. Premier
  élément en place : `sokkan-memory-mcp` (`env=SOKKAN_MEMORY_MCP_TOKEN`, plus `url`). À venir :
  `LLM_PRIMARY_*`, `LLM_FALLBACK_*`, `EXOSCALE_API_KEY`, `EXOSCALE_API_SECRET`, `CLOUDFLARE_API_TOKEN`,
  `TS_API_TOKEN`.
- **Compte de service en lecture seule — FAIT** : membre `nina+starnet@ninabot.ch` (rôle User,
  confirmé, accès limité à la collection `aurane` en Read only). Vérifié depuis un profil `bw` isolé :
  il voit une organisation, une collection, un élément ; l'édition et la création dans la collection
  sont refusées. Ses identifiants CLI et son mot de passe maître vont dans les variables de
  l'environnement cloud (`BW_SERVER`, `BW_CLIENTID`, `BW_CLIENTSECRET`, `BW_PASSWORD`), jamais dans le
  dépôt ; Nick les tient depuis le coffre (élément `vaultwarden-aurane-ci` du dossier propriétaire).
  Révocation = retirer le membre de l'organisation. Outil qui a tout créé, idempotent :
  `infra/vw-tools/vw_starnet_bootstrap.py` (ninabot-pro), API REST + cryptographie client, sans accès
  à la base.
- **Accès CLI (procédure du groupe)** : `bw config server` → `bw login --apikey` → `bw unlock`
  (mot de passe maître obligatoire, la clé API ne suffit pas) → `BW_SESSION` → `bw sync` →
  opérations → `bw lock`. Sous systemd, **toujours `Environment=HOME=/root`** (sinon `bw` ouvre un
  profil vide et répond « unauthenticated » sans erreur — panne muette vécue trois fois). Les
  éléments anciens chiffrés en AES-CBC refusent de se déchiffrer avec un `bw` récent : re-sauver
  l'élément dans l'UI web. Deux pièges du CLI : les avertissements `Failed to decrypt` sortent sur
  **stdout** au milieu du JSON (filtrer les lignes qui ne commencent pas par `[` ou `{`), et un profil
  de test se fait dans un `BITWARDENCLI_APPDATA_DIR` à part pour ne pas écraser la session courante.
- **SMTP est inactif** sur ce Vaultwarden : une invitation ne part pas par mail, le membre invité
  s'inscrit directement (le serveur pose une « invitation » interne). Les inscriptions libres sont
  fermées ; « Allow invitations » a été activé le 24.09 pour créer le membre.
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

1. ~~Rôle + clé IAM Exoscale scopés~~ fait le 24.09 (`terraform-aurane`, compute/dbaas/sos).
2. ~~Tag Tailscale avec grant `rog1:8007` seul~~ fait le 24.09 (`tag:aurane`).
3. ~~Organisation Vaultwarden + collection `aurane` + compte de service lecture seule~~ fait le 24.09 (§4).
4. Exposition du 8007 pour les sessions cloud (Funnel ou Tunnel + Access).
5. Dépôt `ninabot/aurane` sur la forge (renommer aussi le dépôt GitHub) (miroir GitHub) ou GitHub Actions assumé.
6. Budget : SKS + DBaaS + Valkey ≈ 150–250 CHF/mois au-delà du crédit → validation avant `apply`.
