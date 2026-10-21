#!/usr/bin/env bash
# Backs up the production stack: the PostgreSQL database and the uploads volume (voice messages).
#   scripts/backup.sh                  → ~/disslxt-backups, keeps the newest 14 of each
#   BACKUP_DIR=/mnt/x BACKUP_KEEP=30 scripts/backup.sh
# Restore: see README, "Backup & Wiederherstellung".
# Runs nightly from cron (04:00 local = 02:00/03:00 UTC), before the server backup at 03:30 UTC,
# which packs ~/disslxt-backups onto the Storage Box with the rest of the home directory.
set -euo pipefail
cd "$(dirname "$0")/.."

# Optional failure alert via the server's ntfy (topic "backup"), as the nightly server backup does.
NTFY_SEND=${NTFY_SEND:-$HOME/ntfy/scripts/ntfy-send.sh}
on_error() {
  local line=$1
  echo "backup FAILED (line $line)" >&2
  if [ -x "$NTFY_SEND" ]; then
    "$NTFY_SEND" backup "disslxt-Backup fehlgeschlagen" high "warning" \
      "scripts/backup.sh ist in Zeile $line abgebrochen. Log: ~/disslxt-backups/backup.log" || true
  fi
}
trap 'on_error $LINENO' ERR

dest=${BACKUP_DIR:-$HOME/disslxt-backups}
keep=${BACKUP_KEEP:-14}
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "$dest"
chmod 700 "$dest"

# Write to a temp name first, so an interrupted run never looks like a good backup.
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  >"$dest/db-$ts.dump.part"
mv "$dest/db-$ts.dump.part" "$dest/db-$ts.dump"

docker compose exec -T backend tar czf - -C /data/uploads . >"$dest/uploads-$ts.tar.gz.part"
mv "$dest/uploads-$ts.tar.gz.part" "$dest/uploads-$ts.tar.gz"

for kind in db uploads; do
  # shellcheck disable=SC2012 # names are our own timestamps, no odd characters
  ls -1t "$dest/$kind-"* 2>/dev/null | tail -n +"$((keep + 1))" | xargs -r rm --
done

echo "backup ok: $dest/db-$ts.dump ($(du -h "$dest/db-$ts.dump" | cut -f1)), uploads-$ts.tar.gz ($(du -h "$dest/uploads-$ts.tar.gz" | cut -f1))"
