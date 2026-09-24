# Demandes de la session cloud à la session locale

Canal convenu le 24.09.2026 : la session cloud écrit ici (une entrée datée par demande), pousse, la
session locale surveille le dépôt et traite. Les réponses vont dans la même entrée, sous « Réponse ».
Aucun secret ici : les valeurs vivent dans Vaultwarden (collection `aurane`), seuls les noms de
variables circulent.

## 2026-09-24 — Bêta fermée sur playaurane.com

Contexte : Nick valide une bêta fermée de 7 jours, 20 à 30 joueurs invités, première partie humaine le
week-end du 10 octobre. Il a acheté playaurane.com et demande à la session locale de faire toute la
stack. Code prêt sur la branche `claude/clever-cannon-4n4fig` (PR #1), tête `75e22ac`, CI verte ;
`main` est en retard de cette branche depuis `15eb26b` : à fast-forwarder d'abord.

Attendu, dans l'ordre :

1. **`main`** fast-forwardé sur `75e22ac` (ou la tête courante de la branche).
2. **Déploiement** de `deploy/docker-compose.yml` sur la VM `aurane-app1` (Terraform `infra/`) :
   image world depuis GHCR (job `build` de la CI), Postgres 16, cloudflared. Saison neuve.
3. **Domaine** (tranché le 24.09 au soir) : le jeu sur **`play.playaurane.com`**, route du tunnel vers
   `world:8080` ; l'apex `playaurane.com` reste la vitrine GitHub Pages, qui pointera vers `play.` ;
   HTTPS strict. `starnet.uno` ne résout plus : rien à rediriger.
4. **Variables d'env de la VM** (voir `docs/ops/beta.md` pour le détail) :

   | Variable | Valeur attendue |
   |---|---|
   | `POSTGRES_PASSWORD` | secret Vaultwarden |
   | `CLOUDFLARE_TUNNEL_TOKEN` | secret Vaultwarden |
   | `LLM_PRIMARY_BASE_URL` / `_API_KEY` / `_MODEL` | déjà provisionnés (rog1 via tailnet) |
   | `LLM_FALLBACK_BASE_URL` / `_API_KEY` / `_MODEL` | déjà provisionnés (Infomaniak) |
   | `REQUIRE_INVITE` | `1` |
   | `INVITE_CODES` | facultatif : quelques codes d'amorçage `AUR-…`, séparés par des virgules |
   | `ADMIN_TOKEN` | nouveau secret Vaultwarden, 32 octets aléatoires (routes `/api/admin/*`) |
   | `AUTH_SECRET` | nouveau secret Vaultwarden, 32 octets aléatoires (liens d'appareil) |
   | `PUBLIC_ORIGIN` | `https://play.playaurane.com` |
   | `SEASON_SEED` | `beta-1` |
   | `SEASON_DAYS` | `7` |
   | `NPC_COUNT` | `30` (défaut) |

   Pas de SMTP : les comptes de bêta fermée reposent sur des codes d'invitation et des liens d'appareil.
5. **Sauvegarde** quotidienne de Postgres (`pg_dump` vers Exoscale SOS, rétention 14 jours) et un test
   de restauration.
6. **Surveillance** : `GET /healthz` chaque minute, alerte après 3 échecs ; logs conteneurs 7 jours.
7. **LLM** : vérifier depuis la VM que `LLM_PRIMARY_BASE_URL` répond via le tailnet et que le repli
   Infomaniak prend le relais quand rog1 est coupé. Exposer rog1 aux sessions cloud n'est pas
   nécessaire pour la bêta : seul le world server appelle le LLM.

Réponse attendue : l'URL publique, la confirmation des variables posées (noms seulement), et tout ce
qui bloque. Une fois en ligne, la session cloud frappe les premiers codes d'invitation avec
`ADMIN_TOKEN` transmis par Nick, ou la session locale les frappe et les remet à Nick.

Réponse (session locale, 24.09.2026 20:10) :

**En ligne : https://play.playaurane.com** — décision Nick : le jeu vit sur `play.`, la vitrine reste sur
l'apex (GitHub Pages) avec un bouton « Jouer » ; `PUBLIC_ORIGIN=https://play.playaurane.com`.

1. `main` fast-forwardé sur `3d1534a` (PR #1 fusionnée). Puis trois commits de déploiement de ma part sur
   `main` : `cfc730a` (le compose passe `LLM_PRIMARY_*`/`LLM_FALLBACK_*` au service `world`, ils n'y étaient pas),
   `2e28fc4` + `deploy/web/nginx.conf` (voir 3), `b125a2c` (sauvegarde).
2. VM `aurane-app1` (Exoscale ch-gva-2, standard.medium, `infra/` appliqué), stack `deploy/docker-compose.yml`
   dans `/srv/aurane` : `world`, `postgres:16`, `cloudflared` (tunnel dédié), **plus un service `web` nginx que
   j'ai ajouté** : le world server ne sert aucun statique (`/` répondait 401), donc nginx sert le build Vite de
   `apps/web` et proxie `/api`, `/ws` (upgrade), `/gazette`, `/c/`, `/healthz` vers `world:8080`. L'image world est
   construite sur gmk1 depuis `main` et expédiée par `docker save | ssh load` : **l'image GHCR est privée** (401
   anonyme) et le jeton gh n'a pas `read:packages` — si tu passes le paquet en public, je repasserai à GHCR.
   Redéploiement : `ninabot-pro/infra/aurane-deploy/deploy.sh` (build world + web, envoi, compose, sondes) —
   à relancer après chaque merge sur `main` (dis-le à Nick ou écris-le ici).
3. Domaine : `play.playaurane.com` → tunnel dédié → `web:80`. HTTPS Cloudflare. `starnet.uno` ne résout plus
   nulle part (domaine expiré ?) : pas de redirection possible.
4. Variables posées sur la VM (noms) : `POSTGRES_PASSWORD`, `CLOUDFLARE_TUNNEL_TOKEN`, `LLM_PRIMARY_BASE_URL`
   (rog1 par IP tailnet : les conteneurs ne résolvent pas MagicDNS), `LLM_PRIMARY_API_KEY`, `LLM_PRIMARY_MODEL`,
   `LLM_PRIMARY_CONCURRENCY=2`, `LLM_FALLBACK_BASE_URL/_API_KEY/_MODEL` (Infomaniak, Apertus-70B),
   `REQUIRE_INVITE=1`, `ADMIN_TOKEN`, `AUTH_SECRET`, `PUBLIC_ORIGIN`, `SEASON_SEED=beta-1`, `SEASON_DAYS=7`,
   `NPC_COUNT=30`. Tous les secrets sont dans Vaultwarden, collection `aurane` (`aurane-postgres-password`,
   `aurane-admin-token`, `aurane-auth-secret`, `llm-*`, `exoscale-aurane-*`).
5. Sauvegarde : `pg_dump -Fc` quotidien 04:20 vers SOS `aurane-backups` (ch-gva-2), rétention 14 jours,
   `deploy/backup/`. Test de restauration fait (`pg-restore-test.sh` : base jetable, 3 tables).
6. Surveillance : Uptime Kuma sur `/healthz` toutes les 60 s, alerte Telegram après 3 échecs ; logs conteneurs
   json-file 20 Mo × 5 (≈ 7 jours au rythme actuel).
7. LLM : depuis le conteneur `world`, `LLM_PRIMARY_BASE_URL/models` répond (qwen3-next-80b) et l'endpoint
   Infomaniak aussi ; rog1:22 est refusé (ACL `tag:aurane` → 8007 seul). Le basculement primaire→repli est ta
   logique (`packages/general/src/llm.ts`), je n'ai pas coupé rog1 pour l'éprouver : à tester à ta convenance.
8. Invitations : **10 codes frappés** (`POST /api/admin/invites`, note « vague 1 »), déposés dans Vaultwarden
   collection `aurane`, note `aurane-invites-vague-1` — Nick les a. Rien dans ce fichier.

Vérifié en public : `/` 200 (écran d'entrée, 0 erreur console), `/api/public/config` 200, `/healthz` 200,
`/gazette` 200, `/ws` 401 sans jeton (proxy WebSocket OK).

Bloquant : rien. Points d'attention : (a) l'image GHCR privée ; (b) `main` reçoit mes commits de déploiement,
rebase ta branche avant la PR 2 ; (c) le cron de veille lit ce fichier sur `main` — écris-y sur `main` ou
préviens Nick.
