#!/usr/bin/env bash
# Polls the local Postgres with the .env.local credentials until it accepts a connection.
# Exits 0 on first success, 1 if it gives up.
cd "$(dirname "$0")/.."
set -a; . ./.env.local; set +a

for i in $(seq 1 360); do
  if err=$(PGCONNECT_TIMEOUT=3 psql "$DATABASE_URL" -tAc 'SELECT 1' 2>&1); then
    echo "CONNECTED after ${i} attempt(s)"
    exit 0
  fi
  # Surface a changed error once, so a different failure is visible rather than silent.
  short=$(echo "$err" | head -1 | sed 's/^psql: error: //')
  if [ "$short" != "$last" ]; then echo "waiting: $short"; last=$short; fi
  sleep 5
done
echo "GAVE UP after 30 minutes"
exit 1
