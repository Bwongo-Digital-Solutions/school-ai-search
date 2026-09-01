#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
# Must match APP_NAME in containers.sh. The project name is what ties containers, volumes and the
# network together; left to Compose it is derived from the directory name, so a renamed or second
# checkout quietly becomes a second stack alongside the running one.
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-school-ai-search}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but was not found."
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing production env file: $ENV_FILE"
  echo "Copy .env.production.example to .env.production and update the values first."
  exit 1
fi

# Most of this stack sits behind compose profiles — the bundled database, the proxy, Meilisearch,
# LibreChat. Compose reads COMPOSE_PROFILES from the environment and from the env file, but this
# script needs the value itself for the check below, so resolve it once and export it.
if [[ -z "${COMPOSE_PROFILES:-}" ]]; then
  COMPOSE_PROFILES="$(sed -n 's/^COMPOSE_PROFILES=//p' "$ENV_FILE" | tail -n 1 | sed 's/^"//; s/"$//')"
fi
export COMPOSE_PROFILES

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT_NAME" "$@"
}

# Services of this deployment that are running but that this run would not manage, because their
# profile is not enabled. Usually deliberate — redeploying the app alone and leaving the database
# and the proxy up is the common case — so this reports rather than refuses. It is worth reporting
# because the failure it precedes is opaque: anything Compose does not manage here it also does not
# move, so a change to the network in docker-compose.yml strands these containers on the old one
# and stops the deploy with "network ... has active endpoints".
out_of_scope_services() {
  local managed running service
  managed="$(compose config --services 2>/dev/null | sort -u)"
  running="$(docker ps --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --format '{{.Label "com.docker.compose.service"}}' 2>/dev/null | sort -u)"

  for service in $running; do
    [[ -n "$service" ]] || continue
    grep -qx -- "$service" <<<"$managed" || printf '%s\n' "$service"
  done
}

# Which profile brings a service into scope, read back out of the compose file rather than
# hardcoded here, so this keeps working as profiles are added. Runs in a subshell: an assignment
# in front of a shell function outlives the call in bash.
profile_for_service() {
  local profile
  for profile in $(compose config --profiles 2>/dev/null); do
    if (export COMPOSE_PROFILES="$profile"; compose config --services 2>/dev/null) | grep -qx -- "$1"; then
      printf '%s' "$profile"
      return 0
    fi
  done
}

# Reported before the build, which takes minutes, so it is read rather than scrolled past.
mapfile -t out_of_scope < <(out_of_scope_services)
if (( ${#out_of_scope[@]} > 0 )); then
  needed=""
  for service in "${out_of_scope[@]}"; do
    profile="$(profile_for_service "$service")"
    [[ -n "$profile" ]] || continue
    case ",$needed," in
      *",$profile,"*) ;;
      *) needed="${needed:+$needed,}$profile" ;;
    esac
  done

  echo "Note: these services are running for '$PROJECT_NAME' but this deploy will not touch them,"
  echo "because their profiles are not enabled. They keep running as they are."
  printf '  %s\n' "${out_of_scope[@]}"
  if [[ -n "$needed" ]]; then
    echo
    echo "To redeploy them as well:"
    echo "  COMPOSE_PROFILES=${COMPOSE_PROFILES:+$COMPOSE_PROFILES,}$needed $0"
  fi
  echo
fi

echo "Using env file: $ENV_FILE"
echo "Using compose file: $COMPOSE_FILE"
echo "Using project name: $PROJECT_NAME"
echo "Using profiles: ${COMPOSE_PROFILES:-none}"

compose build
compose up -d
compose ps

echo "Deployment completed."
