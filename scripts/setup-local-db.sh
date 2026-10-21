#!/usr/bin/env bash
# Idempotent local PostgreSQL setup for development and tests.
# Creates role chat/chat (local-only dev password, see .env.example) and the
# databases disslxt_dev, disslxt_test, disslxt_e2e. Run as root (uses sudo -u postgres).
set -euo pipefail

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DO \$\$BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='chat') THEN CREATE ROLE chat LOGIN PASSWORD 'chat' CREATEDB; END IF; END\$\$;"
for db in disslxt_dev disslxt_test disslxt_e2e; do
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 || sudo -u postgres createdb -O chat "$db"
done
echo "Local databases ready: disslxt_dev, disslxt_test, disslxt_e2e (role: chat)"
