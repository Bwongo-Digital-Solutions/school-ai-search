#!/usr/bin/env bash
# Creates the role and database that .env expects, on the native PostgreSQL instance.
# Needs superuser. Run it directly -- it prompts once for your sudo password:
#   ./scripts/provision-local-db.sh
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${POSTGRES_USER}') THEN
    CREATE ROLE ${POSTGRES_USER} LOGIN PASSWORD '${POSTGRES_PASSWORD}';
  ELSE
    ALTER ROLE ${POSTGRES_USER} LOGIN PASSWORD '${POSTGRES_PASSWORD}';
  END IF;
END
\$\$;
EOSQL

# CREATE DATABASE cannot run inside a DO block, so it is guarded from the shell instead.
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" | grep -q 1; then
  sudo -u postgres createdb -O "${POSTGRES_USER}" "${POSTGRES_DB}"
  echo "created database ${POSTGRES_DB}"
else
  echo "database ${POSTGRES_DB} already exists"
fi

sudo -u postgres psql -d "${POSTGRES_DB}" -c "GRANT ALL ON SCHEMA public TO ${POSTGRES_USER};"
echo "done — role ${POSTGRES_USER} and database ${POSTGRES_DB} are ready"
