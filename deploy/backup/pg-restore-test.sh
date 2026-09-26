#!/usr/bin/env bash
# pg-restore-test.sh — takes the latest dump from SOS and restores it into a throwaway database `aurane_restoretest` of
# the same Postgres, counts the tables and the memory rows, then drops it; records the success (ops_backups kind
# pg-restore-test). Never touches the database `aurane`.
set -euo pipefail
cd "${AURANE_DIR:-/srv/aurane}"
. "$(dirname "$(readlink -f "$0")")/lib.sh"
LAST=$(s3 ls "s3://$BUCKET/pg/" | awk '{print $4}' | grep '\.dump$' | sort | tail -1)
[ -n "$LAST" ] || { echo "aucun dump"; exit 1; }
trap 'rm -f /var/tmp/restoretest.dump; docker compose exec -T postgres psql -U aurane -d postgres -qc "DROP DATABASE IF EXISTS aurane_restoretest" >/dev/null 2>&1 || true' EXIT
s3 cp --quiet "s3://$BUCKET/pg/$LAST" /var/tmp/restoretest.dump
docker compose exec -T postgres psql -U aurane -d postgres -qc "DROP DATABASE IF EXISTS aurane_restoretest" -c "CREATE DATABASE aurane_restoretest"
docker compose exec -T postgres pg_restore -U aurane -d aurane_restoretest --no-owner --no-acl < /var/tmp/restoretest.dump
N=$(docker compose exec -T postgres psql -U aurane -d aurane_restoretest -tAc "select count(*) from information_schema.tables where table_schema='public'")
M=$(docker compose exec -T postgres psql -U aurane -d aurane_restoretest -tAc "select count(*) from general_memory" 2>/dev/null || echo "?")
[ "$N" -gt 0 ] || { echo "restauration vide"; exit 1; }
record_ops pg-restore-test "$(stat -c %s /var/tmp/restoretest.dump)" "pg/$LAST"
echo "restauration de $LAST : $N tables, $M mémoires"
