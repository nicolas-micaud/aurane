#!/usr/bin/env bash
# memory-restore.sh OBJECT --yes — EMERGENCY: replaces the live long memory with a backup from SOS
# (e.g. memory/aurane-memory-20260927T022041Z.db.gz). The current file is kept aside in the volume
# (/data/memory.db.before-restore-<stamp>). Afterwards the world's hourly reconciliation (or a restart of world) pushes
# every record Postgres holds that is newer than the backup, and re-applies erasures made since: Postgres is the
# working copy, the instance catches up. Check with memory-restore-test.sh and /api/admin/memory/health.
set -euo pipefail
cd "${AURANE_DIR:-/srv/aurane}"
. "$(dirname "$(readlink -f "$0")")/lib.sh"
OBJ=${1:-}; [ -n "$OBJ" ] && [ "${2:-}" = "--yes" ] || { echo "usage: $0 memory/aurane-memory-<stamp>.db.gz --yes"; exit 2; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ); TMP=/var/tmp/memory-restore-$STAMP.db
s3 cp --quiet "s3://$BUCKET/$OBJ" "$TMP.gz" && gunzip -f "$TMP.gz"
python3 -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); assert c.execute("pragma integrity_check").fetchone()[0]=="ok"' "$TMP"
docker compose cp "$TMP" memory:/data/memory.db.restore
docker compose stop memory
docker compose run --rm --no-deps --user 0 --entrypoint sh memory -c "cd /data && cp -p memory.db memory.db.before-restore-$STAMP && rm -f memory.db-wal memory.db-shm && mv memory.db.restore memory.db && chown mem:mem memory.db"
docker compose up -d memory
rm -f "$TMP"
echo "mémoire restaurée depuis $OBJ ; ancienne base gardée en /data/memory.db.before-restore-$STAMP"
echo "réconciliation : docker compose restart world (ou attendre l'heure) puis GET /api/admin/memory/health"
