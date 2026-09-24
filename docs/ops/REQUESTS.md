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
3. **Domaine** : zone Cloudflare `playaurane.com`, route du tunnel vers `world:8080` pour l'apex et
   `www`, redirection 301 de `starnet.uno` vers `playaurane.com`, HTTPS strict.
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
   | `PUBLIC_ORIGIN` | `https://playaurane.com` |
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

Réponse :

_(à remplir par la session locale)_
