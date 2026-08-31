#!/bin/sh
# Checks that a school is fully live: registered, given its own database, reachable at its
# subdomain, and isolated from every other school.
#
#   ./scripts/verify-school.sh kampala-high
#
# Run from the repo directory on the server.
set -u

SUB="${1:-}"
[ -n "$SUB" ] || { echo "usage: $0 <subdomain>" >&2; exit 1; }

ENV_FILE="${ENV_FILE:-.env.production}"
value() { grep "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- ; }

DOMAIN="$(value TENANT_ROOT_DOMAIN)"; DOMAIN="${DOMAIN:-eschool.ink}"
TOKEN="$(value PLATFORM_OWNER_TOKEN)"
PREFIX="$(value TENANT_DB_PREFIX)"; PREFIX="${PREFIX:-school_}"
# dbNameFor() in provisioning.mjs: the prefix plus the subdomain with hyphens turned into underscores.
DB="$PREFIX$(printf '%s' "$SUB" | tr '-' '_')"

echo "=== 1. Is it in the registry, and active? ==="
curl -sS -X POST "https://$DOMAIN/api/provision" \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"status\",\"subdomain\":\"$SUB\"}"
echo

echo "=== 2. Does it have its own database? ==="
docker exec school-ai-search-db psql -U schoolapp -d postgres -tAc \
  "SELECT datname FROM pg_database WHERE datname = '$DB';" | grep -q . \
  && echo "  yes: $DB" || echo "  NO — $DB was never created"

echo
echo "=== 3. Does its subdomain serve? ==="
curl -sS -o /dev/null -w '  https://%{url_effective#https://}  ->  %{http_code}\n' \
  "https://$SUB.$DOMAIN/api/health" 2>/dev/null \
  || curl -sS -o /dev/null -w "  %{http_code}\n" "https://$SUB.$DOMAIN/api/health"
curl -sS "https://$SUB.$DOMAIN/api/health"; echo

echo "=== 4. Is it isolated? (its own rows, not the default school's) ==="
for d in "$DB" school_ai_search; do
  printf '  %-28s students=%s users=%s\n' "$d" \
    "$(docker exec school-ai-search-db psql -U schoolapp -d "$d" -tAc 'SELECT count(*) FROM students;' 2>/dev/null || echo '-')" \
    "$(docker exec school-ai-search-db psql -U schoolapp -d "$d" -tAc 'SELECT count(*) FROM users;' 2>/dev/null || echo '-')"
done

echo
echo "=== 5. Every school on the platform ==="
if [ -n "$TOKEN" ]; then
  curl -sS -X POST "https://$DOMAIN/api/provision" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"action":"list"}'
  echo
else
  echo "  (no PLATFORM_OWNER_TOKEN in $ENV_FILE — skipped)"
fi
