#!/usr/bin/env bash
# notify-deploy.sh — tells the outside tester (Grok Automations « Aurane - notif déploiement ») that a production
# deploy succeeded. Called by the deploy pipeline AFTER https://play.playaurane.com answers 200, never before.
#   GROK_DEPLOY_WEBHOOK_URL     endpoint of the automation; absent = skip (logged), exit 0
#   GROK_DEPLOY_WEBHOOK_SECRET  optional whsec_… secret: the request is then signed the Standard Webhooks way
#                               (webhook-id, webhook-timestamp, webhook-signature: v1,base64(HMAC-SHA256(id.ts.body)))
#   NOTIFY_ENV (prod), NOTIFY_URL (https://play.playaurane.com), NOTIFY_REPO (repo to read the commit from, default .)
# Never fails the deploy: any error is a warning on stderr and exit 0. Only curl, git, openssl and base64.
set -uo pipefail
warn() { echo "[notify-deploy] $*" >&2; }
URL=${GROK_DEPLOY_WEBHOOK_URL:-}
[ -n "$URL" ] || { warn "GROK_DEPLOY_WEBHOOK_URL not set, skipped"; exit 0; }
REPO=${NOTIFY_REPO:-.}
COMMIT=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)
VERSION=$(git -C "$REPO" describe --tags --exact-match 2>/dev/null || git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)
SUBJECT=$(git -C "$REPO" log -1 --format=%s 2>/dev/null || echo "")
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
json_str() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/ }; s=${s//$'\t'/ }; printf '"%s"' "$s"; }
BODY=$(printf '{"project":"aurane","env":%s,"version":%s,"commit":%s,"message":%s,"deployed_at":%s,"url":%s}' \
  "$(json_str "${NOTIFY_ENV:-prod}")" "$(json_str "$VERSION")" "$(json_str "$COMMIT")" "$(json_str "$SUBJECT")" \
  "$(json_str "$NOW")" "$(json_str "${NOTIFY_URL:-https://play.playaurane.com}")")
HDR=(-H 'Content-Type: application/json' -H 'User-Agent: aurane-deploy/1')
SECRET=${GROK_DEPLOY_WEBHOOK_SECRET:-}
if [ -n "$SECRET" ]; then
  ID="msg_aurane_${COMMIT:0:12}_$(date -u +%s)"; TS=$(date -u +%s)
  KEY_HEX=$(printf '%s' "${SECRET#whsec_}" | base64 -d 2>/dev/null | od -An -vtx1 | tr -d ' \n')
  if [ -n "$KEY_HEX" ]; then
    SIG=$(printf '%s.%s.%s' "$ID" "$TS" "$BODY" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$KEY_HEX" -binary | base64)
    HDR+=(-H "webhook-id: $ID" -H "webhook-timestamp: $TS" -H "webhook-signature: v1,$SIG")
  else warn "GROK_DEPLOY_WEBHOOK_SECRET is not base64 after whsec_, sending unsigned"; fi
fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST "${HDR[@]}" --data "$BODY" "$URL" 2>/dev/null) || CODE=000
case "$CODE" in 2??) echo "[notify-deploy] sent ($CODE) version $VERSION" ;; *) warn "webhook answered $CODE, deploy not affected" ;; esac
exit 0
