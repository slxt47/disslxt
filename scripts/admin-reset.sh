#!/bin/bash
# Löscht ALLE Konten von disslxt – und damit alle Server, Kanäle, Nachrichten, Freundschaften und
# hochgeladenen Dateien – und legt danach ein einziges neues Konto an (bereits bestätigt, mit Badge).
#
# Aufruf (im echten Terminal, im Repo-Ordner):
#   scripts/admin-reset.sh <e-mail> <benutzername> [badge]      # badge: Standard "admin"
# Das Passwort wird verdeckt abgefragt (nie als Argument: sonst stünde es in ps und im Verlauf).
# Vorher läuft scripts/backup.sh (Datenbank + Uploads nach ~/backups/disslxt).
set -euo pipefail
cd "$(dirname "$0")/.."

EMAIL=${1:?E-Mail fehlt – Aufruf: scripts/admin-reset.sh <e-mail> <benutzername> [badge]}
USERNAME=${2:?Benutzername fehlt}
BADGE=${3:-admin}
[ -t 0 ] || { echo "Bitte in einem echten Terminal ausführen (Passwort wird verdeckt abgefragt)."; exit 1; }
[[ $USERNAME =~ ^[A-Za-z0-9_]{3,32}$ ]] || { echo "Benutzername: 3–32 Zeichen, nur A–Z, 0–9 und _"; exit 1; }
[[ $BADGE =~ ^[a-z0-9-]{1,16}$ ]] || { echo "Badge: 1–16 Zeichen a–z, 0–9, -"; exit 1; }

echo "ACHTUNG: Alle Konten, Server, Nachrichten und Dateien von disslxt werden gelöscht."
echo "Danach gibt es nur noch: $USERNAME <$EMAIL> mit Badge \"$BADGE\"."
read -r -p 'Zum Bestätigen "ALLES LÖSCHEN" eintippen: ' OK
[ "$OK" = "ALLES LÖSCHEN" ] || { echo "Abgebrochen – nichts geändert."; exit 1; }

read -r -s -p "Passwort für $USERNAME (mind. 10 Zeichen): " PW1; echo
read -r -s -p "Nochmal: " PW2; echo
[ "$PW1" = "$PW2" ] || { echo "Die Eingaben sind verschieden – nichts geändert."; exit 1; }
[ "${#PW1}" -ge 10 ] || { echo "Zu kurz – nichts geändert."; exit 1; }

echo "Backup …"
BACKUP_DIR=${BACKUP_DIR:-$HOME/backups/disslxt} scripts/backup.sh

# Gleiche argon2id-Parameter wie backend/src/lib/password.ts.
HASH=$(printf '%s' "$PW1" | docker compose exec -T backend node -e '
  const { hash } = require("@node-rs/argon2");
  let pw = "";
  process.stdin.on("data", (d) => (pw += d)).on("end", async () => {
    process.stdout.write(await hash(pw, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 }));
  });')
unset PW1 PW2
[[ $HASH == '$argon2id$'* ]] || { echo "Hash fehlgeschlagen – nichts geändert."; exit 1; }

echo "Datenbank …"
# TRUNCATE … CASCADE leert alles, was an Konten hängt (Sitzungen, Server, Kanäle, Nachrichten,
# Freunde, private Chats, Push-Abos, Reset-Links). Werte gehen als psql-Variablen hinein.
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v email="$1" -v username="$2" -v hash="$3" -v badge="$4"' _ "$EMAIL" "$USERNAME" "$HASH" "$BADGE" <<'SQL'
BEGIN;
TRUNCATE users, pending_registrations, mail_log RESTART IDENTITY CASCADE;
INSERT INTO users (email, username, password_hash, email_verified_at, badge)
VALUES (lower(:'email'), :'username', :'hash', now(), :'badge');
COMMIT;
SQL

echo "Dateien …"
docker compose exec -T backend sh -c 'rm -rf /data/uploads/files /data/uploads/voice /data/uploads/avatars'

# Neustart: offene Verbindungen und Anrufe der gelöschten Konten sind sofort weg.
docker compose restart backend >/dev/null
echo "Fertig. Anmelden mit $EMAIL – alle anderen Konten sind gelöscht."
