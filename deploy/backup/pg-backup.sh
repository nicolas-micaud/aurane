#!/usr/bin/env bash
# pg-backup.sh — dump quotidien de la base Aurane vers Exoscale SOS (bucket aurane-backups, ch-gva-2), rétention 14 jours.
# Tourne sur la VM aurane-app1 (timer systemd aurane-pg-backup.timer). Creds S3 = clé scopée terraform-aurane
# (/etc/aurane/backup.env : AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY). Test de restauration : pg-restore-test.sh.
set -euo pipefail
cd /srv/aurane
set -a; . /etc/aurane/backup.env; set +a
BUCKET=${BACKUP_BUCKET:-aurane-backups}; ENDPOINT=${BACKUP_ENDPOINT:-https://sos-ch-gva-2.exo.io}
STAMP=$(date -u +%Y%m%dT%H%M%SZ); OUT=/var/tmp/aurane-${STAMP}.dump
docker compose exec -T postgres pg_dump -U aurane -d aurane -Fc > "$OUT"
[ -s "$OUT" ] || { echo "dump vide"; exit 1; }
aws --endpoint-url "$ENDPOINT" s3 cp --quiet "$OUT" "s3://$BUCKET/pg/aurane-${STAMP}.dump"
rm -f "$OUT"
# rétention 14 jours
CUTOFF=$(date -u -d '14 days ago' +%Y%m%dT%H%M%SZ)
aws --endpoint-url "$ENDPOINT" s3 ls "s3://$BUCKET/pg/" | awk '{print $4}' | while read -r f; do
  s=${f#aurane-}; s=${s%.dump}; [ -n "$s" ] && [[ "$s" < "$CUTOFF" ]] && aws --endpoint-url "$ENDPOINT" s3 rm --quiet "s3://$BUCKET/pg/$f" && echo "purgé $f"
done
echo "backup ok aurane-${STAMP}.dump"
