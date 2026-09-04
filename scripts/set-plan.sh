#!/bin/sh
# Sets, or shows, which tier a school is on.
#
#   ./scripts/set-plan.sh kampala-high professional   # sell them Professional
#   ./scripts/set-plan.sh kampala-high                # just show what they are on
#   ./scripts/set-plan.sh --list                      # every school and its tier
#
# Run from the repo directory on the server. Goes through the platform owner API rather than
# straight into the control database, so a plan set here takes the same path, the same validation
# and the same cache invalidation as one set from the owner console — one way for a thing to happen
# is one way for it to be wrong.
#
# The tiers, cheapest first. Each includes everything below it:
#
#   essential      students, records, staff accounts, school data, settings, messages,
#                  fees (payments, receipts, statements), registration, scanning
#   standard       + teaching, lessons, clubs and requirements, dormitories, roll call,
#                  meals, gate passes, recording marks
#   professional   + examiner, finance, billing runs, arrears, bursaries, ERP, audit,
#                  monitoring, integrations
#   enterprise     + AI assistant, AI reports and papers, reading marks off a photograph,
#                  e-learning, search
#
# A one-off install with no control plane keeps its licence in its own database instead, and this
# script says so rather than pretending to have worked.
set -u

ENV_FILE="${ENV_FILE:-.env.production}"
value() { grep "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- ; }

DOMAIN="$(value TENANT_ROOT_DOMAIN)"; DOMAIN="${DOMAIN:-eschool.ink}"
TOKEN="${PLATFORM_OWNER_TOKEN:-$(value PLATFORM_OWNER_TOKEN)}"

api() {
  curl -sS -X POST "https://$DOMAIN/api/provision" \
    -H 'Content-Type: application/json' \
    -H "X-Platform-Owner-Token: $TOKEN" \
    -d "$1"
}

# Pretty-print when python is around, fall back to the raw body when it is not. A script that
# refuses to run on a box without python is a script nobody can use in an emergency.
show() {
  if command -v python3 >/dev/null 2>&1; then python3 -m json.tool 2>/dev/null || cat
  else cat
  fi
}

usage() {
  echo "usage: $0 <subdomain> [essential|standard|professional|enterprise]" >&2
  echo "       $0 --list" >&2
  exit 1
}

[ $# -ge 1 ] || usage

case "${1:-}" in -h|--help) usage ;; esac

# Checked after the arguments: being told a token is missing teaches nothing to somebody who simply
# typed the command wrong.
require_token() {
  if [ -z "$TOKEN" ]; then
    echo "No PLATFORM_OWNER_TOKEN in $ENV_FILE or the environment." >&2
    echo "Without it the platform refuses owner actions, which is the point of it." >&2
    exit 1
  fi
}

if [ "${1:-}" = "--list" ] || [ "${1:-}" = "-l" ]; then
  require_token
  api '{"action":"list"}' | show
  exit 0
fi

SUB="${1:-}"
PLAN="${2:-}"

[ -n "$SUB" ] || usage

if [ -z "$PLAN" ]; then
  require_token
  echo "=== What $SUB is on now ==="
  api '{"action":"list"}' \
    | { if command -v python3 >/dev/null 2>&1; then
          python3 -c "
import json,sys
sub = sys.argv[1]
data = json.load(sys.stdin)
rows = (data.get('data') or data).get('tenants') or []
for t in rows:
    if t.get('subdomain') == sub:
        print(f\"{t['subdomain']}: plan={t.get('plan')} status={t.get('status')}\")
        break
else:
    print(f'{sub} is not in the platform registry.')
" "$SUB"
        else cat
        fi; }
  exit 0
fi

case "$PLAN" in
  essential|standard|professional|enterprise) ;;
  *)
    echo "Unknown tier: $PLAN" >&2
    echo "Use one of: essential, standard, professional, enterprise" >&2
    exit 1
    ;;
esac

require_token

# A downgrade takes effect at once, so say what is about to happen before it happens.
echo "Setting $SUB to $PLAN on $DOMAIN."
printf 'This takes effect within a minute, for everyone signed in. Continue? [y/N] '
read -r REPLY
case "$REPLY" in
  y|Y|yes|YES) ;;
  *) echo "Left alone."; exit 0 ;;
esac

RESULT="$(api "{\"action\":\"set_plan\",\"subdomain\":\"$SUB\",\"plan\":\"$PLAN\"}")"
echo "$RESULT" | show

# The API reports a refusal in the body with a 200, so the exit code has to come from reading it
# rather than from curl: a script that exits 0 on "Unknown school" is a script that lies.
if printf '%s' "$RESULT" | grep -q '"error"'; then
  exit 1
fi
