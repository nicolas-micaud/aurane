#!/usr/bin/env bash
# pg-backup.sh — nightly backup of Aurane to Exoscale SOS (bucket aurane-backups, ch-gva-2), 14-day retention.
# Runs on aurane-app1 (systemd aurane-pg-backup.timer, 04:20). Two parts, each recorded in Postgres ops_backups on
# success (the world exposes their age: aurane_backup_age_seconds, /api/admin/memory/health):
#   pg/      pg_dump -Fc of the world database
#   memory/  the Generals' long memory (aurane-memory, SQLite): a consistent VACUUM INTO copy made and checked by the
#            instance itself, never a copy of the live file.
# A failed part fails the unit (exit 1) after the other part has run. Restore tests: pg-restore-test.sh,
# memory-restore-test.sh (timer aurane-restore-test, weekly).
set -euo pipefail
cd "${AURANE_DIR:-/srv/aurane}"
. "$(dirname "$(readlink -f "$0")")/lib.sh"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FAIL=0

OUT=/var/tmp/aurane-${STAMP}.dump
if docker compose exec -T postgres pg_dump -U aurane -d aurane -Fc > "$OUT" && [ -s "$OUT" ] \
   && s3 cp --quiet "$OUT" "s3://$BUCKET/pg/aurane-${STAMP}.dump"; then
  record_ops pg "$(stat -c %s "$OUT")" "pg/aurane-${STAMP}.dump" || { echo "ÉCHEC enregistrement ops_backups pg" >&2; FAIL=1; }
  echo "backup pg ok aurane-${STAMP}.dump ($(stat -c %s "$OUT") octets)"
else
  echo "ÉCHEC backup pg" >&2; FAIL=1
fi
rm -f "$OUT"

if docker compose ps --status running --format '{{.Service}}' | grep -qx memory; then
  MEM=/var/tmp/aurane-memory-${STAMP}.db
  if RES=$(memory_api POST /admin/backup) \
     && FILE=$(printf '%s' "$RES" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"] and d["integrity"]=="ok"; print(d["file"])') \
     && docker compose cp "memory:/data/backups/$FILE" "$MEM" && [ -s "$MEM" ] && gzip -f "$MEM" \
     && s3 cp --quiet "$MEM.gz" "s3://$BUCKET/memory/aurane-memory-${STAMP}.db.gz"; then
    record_ops memory "$(stat -c %s "$MEM.gz")" "memory/aurane-memory-${STAMP}.db.gz" || { echo "ÉCHEC enregistrement ops_backups memory" >&2; FAIL=1; }
    echo "backup mémoire ok aurane-memory-${STAMP}.db.gz ($RES)"
  else
    echo "ÉCHEC backup mémoire longue" >&2; FAIL=1
  fi
  rm -f "$MEM" "$MEM.gz"
else
  echo "ÉCHEC backup mémoire longue : service memory arrêté" >&2; FAIL=1
fi

purge pg .dump
purge memory .db.gz
purge memory .json   # anciennes exportations JSON (avant VACUUM INTO)
exit $FAIL
