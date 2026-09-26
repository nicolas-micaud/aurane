#!/usr/bin/env bash
# memory-restore-test.sh — takes the latest memory backup from SOS, checks it inside the memory container (integrity,
# schema, row count against the live instance), and records the success (ops_backups kind memory-restore-test).
# Never touches the live base /data/memory.db.
set -euo pipefail
cd "${AURANE_DIR:-/srv/aurane}"
. "$(dirname "$(readlink -f "$0")")/lib.sh"
LAST=$(s3 ls "s3://$BUCKET/memory/" | awk '{print $4}' | grep '\.db\.gz$' | sort | tail -1)
[ -n "$LAST" ] || { echo "aucune sauvegarde mémoire (.db.gz)"; exit 1; }
TMP=/var/tmp/memory-restoretest.db
trap 'rm -f "$TMP" "$TMP.gz"; docker compose exec -T -u 0 memory rm -f /tmp/restoretest.db >/dev/null 2>&1 || true' EXIT
s3 cp --quiet "s3://$BUCKET/memory/$LAST" "$TMP.gz"
gunzip -f "$TMP.gz"
docker compose cp "$TMP" memory:/tmp/restoretest.db
docker compose exec -T memory python -c '
import json, os, sqlite3, sys, urllib.request
c = sqlite3.connect("file:/tmp/restoretest.db?mode=ro", uri=True)
ok = c.execute("pragma integrity_check").fetchone()[0]
schema = c.execute("pragma user_version").fetchone()[0]
rows = c.execute("select count(*) from memory where erased_at is null").fetchone()[0]
live = json.load(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8090/admin/index", headers={"authorization": "Bearer " + os.environ["MEMORY_TOKEN"]}), timeout=20))
live_rows = sum(1 for v in live.values() if not v["erased"])
print(json.dumps({"integrity": ok, "schema": schema, "rows": rows, "liveRows": live_rows}))
sys.exit(0 if ok == "ok" and schema >= 1 and rows <= live_rows + 1000 else 1)'
record_ops memory-restore-test "$(stat -c %s "$TMP")" "memory/$LAST"
echo "restauration test mémoire ok : $LAST"
