#!/usr/bin/env bash
# Backs up the production stack: the PostgreSQL database and the uploads volume (voice messages).
#   scripts/backup.sh                  → ~/disslxt-backups, keeps the newest 14 of each
#   BACKUP_DIR=/mnt/x BACKUP_KEEP=30 scripts/backup.sh
# Restore: see README, "Backup & Wiederherstellung".
set -euo pipefail
cd "$(dirname "$0")/.."

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
