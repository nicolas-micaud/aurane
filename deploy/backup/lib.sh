# lib.sh — shared by the Aurane backup scripts (sourced, run from /srv/aurane on aurane-app1).
# Creds S3 = scoped key terraform-aurane in /etc/aurane/backup.env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).
set -a; . "${BACKUP_ENV:-/etc/aurane/backup.env}"; set +a
BUCKET=${BACKUP_BUCKET:-aurane-backups}; ENDPOINT=${BACKUP_ENDPOINT:-https://sos-ch-gva-2.exo.io}
AWS=${AWS:-$(command -v aws || echo /snap/bin/aws)}
s3() { "$AWS" --endpoint-url "$ENDPOINT" s3 "$@"; }

# record_ops KIND BYTES OBJECT — last success, read by the world (aurane_backup_* metrics, /api/admin/memory/health).
record_ops() {
  docker compose exec -T postgres psql -U aurane -d aurane -qv ON_ERROR_STOP=1 \
    -v kind="$1" -v bytes="$2" -v obj="$3" <<'SQL'
set client_min_messages = warning;
create table if not exists ops_backups (kind text primary key, at timestamptz not null, bytes bigint, object text);
insert into ops_backups (kind, at, bytes, object) values (:'kind', now(), :'bytes', :'obj')
  on conflict (kind) do update set at = excluded.at, bytes = excluded.bytes, object = excluded.object;
SQL
}

# memory_api METHOD PATH — call the memory instance from inside its container, with the token it already holds
# (the token never appears on the host's command lines).
memory_api() {
  docker compose exec -T memory python -c '
import os, sys, urllib.request
r = urllib.request.Request("http://127.0.0.1:8090" + sys.argv[2], method=sys.argv[1], headers={"authorization": "Bearer " + os.environ["MEMORY_TOKEN"]})
sys.stdout.write(urllib.request.urlopen(r, timeout=120).read().decode())' "$1" "$2"
}

# purge PREFIX SUFFIX — objects older than 14 days (names carry a UTC stamp: aurane-...-YYYYmmddTHHMMSSZ.SUFFIX).
purge() {
  local cutoff; cutoff=$(date -u -d '14 days ago' +%Y%m%dT%H%M%SZ)
  s3 ls "s3://$BUCKET/$1/" | awk '{print $4}' | while read -r f; do
    [[ "$f" == *"$2" ]] || continue
    s=${f%"$2"}; s=${s##*-}
    if [ -n "$s" ] && [[ "$s" < "$cutoff" ]]; then s3 rm --quiet "s3://$BUCKET/$1/$f"; echo "purgé $1/$f"; fi
  done
}
