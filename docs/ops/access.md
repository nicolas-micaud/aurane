# Accès depuis les sessions Claude Code (cloud)

Les sessions cloud tournent dans un conteneur isolé, hors du tailnet. Trois choses
leur manquent par défaut : la mémoire ninabot (corthexis), les secrets (Vaultwarden)
et rog1. Ce document décrit comment les brancher. Rien ici ne contient de secret.

## État constaté le 24.09.2026

- `corthexis.com` et `api.exoscale.com` sont **refusés par la politique réseau** de
  l'environnement (le proxy répond 403 au CONNECT).
- Aucun binaire Tailscale dans le conteneur, pas de TUN : le tailnet est hors de portée.
- Connecteurs disponibles dans la session : Gmail et Google Drive seulement.
- La mise en place d'un hook de démarrage a été bloquée par le classificateur de
  permissions (« persistance non autorisée »). Il faut l'autoriser explicitement
  (voir « Hook de session » ci-dessous).

## Plan de branchement

### 1. Mémoire (corthexis)

Deux voies, cumulables :

- **Connecteur MCP** (recommandé) : si corthexis expose un serveur MCP, l'ajouter comme
  connecteur personnalisé sur https://claude.ai/customize/connectors, puis ouvrir une
  nouvelle session. La mémoire devient interrogeable à la demande (recherche, écriture),
  pas seulement importée.
- **Import au démarrage** : un hook `SessionStart` télécharge la mémoire (Markdown, ou
  JSON avec un champ `markdown`) depuis `CORTHEXIS_MEMORY_URL` avec `CORTHEXIS_TOKEN`
  en Bearer, l'écrit dans `.claude/memory/corthexis.md` (ignoré par git), et
  `CLAUDE.md` l'importe. La mémoire est alors dans le contexte dès le premier message.

### 2. Secrets (Vaultwarden)

Le même hook, si `BW_SERVER`, `BW_CLIENTID`, `BW_CLIENTSECRET` et `BW_PASSWORD` sont
définis et que le CLI `bw` est installé (script de setup : `npm i -g @bitwarden/cli`),
se connecte à Vaultwarden, lit le collection `aurane` et exporte chaque élément comme
variable d'environnement nommée d'après son champ personnalisé `env`
(ex. `LLM_FALLBACK_API_KEY`) via `$CLAUDE_ENV_FILE`.

Un compte Vaultwarden **dédié, en lecture seule** sur le collection `aurane` est
préférable au compte personnel : les identifiants vivent dans les variables de
l'environnement cloud, pas dans le dépôt, et se révoquent d'un clic.

### 3. rog1 et le tailnet

Le conteneur ne peut pas rejoindre le tailnet. Deux options, du plus simple au plus
propre, toutes deux sans exposer rog1 en clair :

1. **Tailscale Funnel** sur rog1 devant l'API LLM, protégé par un jeton : une URL
   publique, chiffrée, révocable. Suffisant pour le développement.
2. **Cloudflare Tunnel + Access** (jeton de service) devant la même API : même résultat,
   journalisation et règles côté Cloudflare, cohérent avec le frontal du jeu.

En production ce débat n'existe pas : les nœuds Exoscale rejoignent le tailnet (clés
éphémères, ACL limitée au port LLM) et parlent à rog1 en privé.

## À configurer une fois (côté ninabot)

Dans les réglages de l'environnement cloud (menu de l'environnement dans la barre de
titre de la session, puis *Edit*) :

| Réglage | Valeur |
|---|---|
| Network access | ajouter l'hôte corthexis, l'hôte Vaultwarden, `api.exoscale.com`, `api.cloudflare.com`, le point d'entrée LLM public |
| Variables d'environnement | `CORTHEXIS_MEMORY_URL`, `CORTHEXIS_TOKEN`, `BW_SERVER`, `BW_CLIENTID`, `BW_CLIENTSECRET`, `BW_PASSWORD` |
| Setup script | `npm i -g @bitwarden/cli` |

Les variables LLM (`LLM_PRIMARY_*`, `LLM_FALLBACK_*`) ne se mettent **pas** dans
l'environnement : elles viennent de Vaultwarden via le hook.

## Hook de session

Le hook est un script `.claude/hooks/session-start.sh` déclaré dans
`.claude/settings.json` (`hooks.SessionStart`). Sa création par l'agent a été refusée
par la politique de permissions de la session. Deux façons de débloquer :

- lancer soi-même `/session-start-hook` dans une session, et valider la création ;
- ou ajouter une règle de permission autorisant l'écriture sous `.claude/` puis
  redemander à l'agent.

Le comportement attendu du script : gaté sur `CLAUDE_CODE_REMOTE=true`, idempotent,
jamais bloquant (une variable absente ou un hôte injoignable produit une ligne de
journal), et il ne journalise jamais une valeur de secret.
