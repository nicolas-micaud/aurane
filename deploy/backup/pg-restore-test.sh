#!/usr/bin/env bash
# pg-restore-test.sh — prend le dernier dump sur SOS et le restaure dans une base jetable `aurane_restoretest`
# du même Postgres, compte les tables, puis supprime la base. Ne touche pas à la base `aurane`.
set -euo pipefail
cd /srv/aurane
set -a; . /etc/aurane/backup.env; set +a
BUCKET=${BACKUP_BUCKET:-aurane-backups}; ENDPOINT=${BACKUP_ENDPOINT:-https://sos-ch-gva-2.exo.io}
LAST=$(aws --endpoint-url "$ENDPOINT" s3 ls "s3://$BUCKET/pg/" | awk '{print $4}' | sort | tail -1)
[ -n "$LAST" ] || { echo "aucun dump"; exit 1; }
aws --endpoint-url "$ENDPOINT" s3 cp --quiet "s3://$BUCKET/pg/$LAST" /var/tmp/restoretest.dump
docker compose exec -T postgres psql -U aurane -d postgres -qc "DROP DATABASE IF EXISTS aurane_restoretest" -c "CREATE DATABASE aurane_restoretest"
docker compose exec -T postgres pg_restore -U aurane -d aurane_restoretest --no-owner --no-acl < /var/tmp/restoretest.dump
N=$(docker compose exec -T postgres psql -U aurane -d aurane_restoretest -tAc "select count(*) from information_schema.tables where table_schema='public'")
docker compose exec -T postgres psql -U aurane -d postgres -qc "DROP DATABASE aurane_restoretest"
rm -f /var/tmp/restoretest.dump
echo "restauration de $LAST : $N tables"
