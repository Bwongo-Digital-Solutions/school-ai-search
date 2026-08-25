#!/usr/bin/env sh
set -eu

APP_NAME="school-ai-search"
PROD_COMPOSE_FILE="docker-compose.yml"
DEV_COMPOSE_FILE="docker-compose.dev.yml"

usage() {
  cat <<'EOF'
School AI Search container helper

Usage:
  ./containers.sh <command> [environment]
  ./containers.sh

Commands:
  build      Build the app image and services
  rebuild    Build the app image and services without Docker cache
  start      Start containers in the background
  stop       Stop containers without deleting data
  restart    Stop and start containers
  delete     Stop containers and delete project volumes
  status     Show container status
  logs       Follow container logs
  endpoints  Show application URLs and ports

Environments:
  prod       Production stack from docker-compose.yml (default)
  dev        Live-reload stack from docker-compose.dev.yml

Examples:
  ./containers.sh build
  ./containers.sh rebuild
  ./containers.sh start prod
  ./containers.sh start dev
  ./containers.sh stop
  ./containers.sh delete dev
EOF
}

print_menu() {
  cat <<'EOF'

School AI Search container helper

Choose an environment:
  1) Production
  2) Development
  0) Exit
EOF
}

print_action_menu() {
  cat <<'EOF'

Choose an action:
  1) Build containers
  2) Rebuild containers without cache
  3) Start containers
  4) Stop containers
  5) Restart containers
  6) Delete containers and volumes
  7) Show container status
  8) Follow logs
  9) Show application endpoints
  10) Change environment
  0) Exit
EOF
}

prompt() {
  printf '%s' "$1" >&2
  read -r reply
  printf '%s' "$reply"
}

confirm_delete() {
  answer="$(prompt "This deletes containers and named volumes for $environment. Continue? [y/N] ")"
  case "$answer" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      printf 'Delete cancelled.\n'
      return 1
      ;;
  esac
}

set_environment() {
  environment="$1"
  case "$environment" in
    prod)
      compose_file="$PROD_COMPOSE_FILE"
      project_name="$APP_NAME"
      environment_label="Production"
      ;;
    dev)
      compose_file="$DEV_COMPOSE_FILE"
      project_name="$APP_NAME-dev"
      environment_label="Development"
      ;;
    *)
      printf 'Unknown environment: %s\n\n' "$environment" >&2
      usage
      exit 1
      ;;
  esac
}

# Which Compose is installed, worked out once on first use.
#
# `docker compose` (the v2 CLI plugin) and `docker-compose` (the v1 standalone) take the same flags
# for everything this script does. Machines that have Docker Engine from a distribution package
# often have neither, or only the standalone one — and a missing plugin fails obscurely: the Docker
# CLI stops recognising `compose` as a command and reads the next argument as its own, which is
# where "unknown shorthand flag: 'p' in -p" comes from.
compose_bin=""

detect_compose() {
  [ -n "$compose_bin" ] && return 0

  if ! command -v docker >/dev/null 2>&1; then
    cat >&2 <<'EOF'
Docker is not installed, or is not on PATH.

Install Docker Engine, then run this script again:
  https://docs.docker.com/engine/install/
EOF
    exit 1
  fi

  if docker compose version >/dev/null 2>&1; then
    compose_bin="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    compose_bin="docker-compose"
  else
    cat >&2 <<'EOF'
Docker is installed, but Docker Compose is not.

Install the Compose plugin, then run this script again:
  Debian/Ubuntu:  sudo apt-get install docker-compose-plugin
  RHEL/Fedora:    sudo dnf install docker-compose-plugin
  Other:          https://docs.docker.com/compose/install/linux/

Check it with:  docker compose version
EOF
    exit 1
  fi
}

compose() {
  detect_compose
  # Unquoted on purpose: "docker compose" has to split into a command and its subcommand.
  # shellcheck disable=SC2086
  $compose_bin -p "$project_name" -f "$compose_file" "$@"
}

show_endpoints() {
  if [ "$environment" = "prod" ]; then
    app_port="${APP_PORT:-8787}"
    database_name="${POSTGRES_DB:-school_ai_search}"
    database_user="${POSTGRES_USER:-schoolapp}"

    cat <<EOF

Application locations for $environment_label:
  Frontend and backend: http://127.0.0.1:$app_port
  Backend health check: http://127.0.0.1:$app_port/api/health
  PostgreSQL database: db:5432 inside Docker network
  Database name: $database_name
  Database user: $database_user

Production exposes the built React frontend and backend API from the same app container.
EOF
  else
    frontend_port="${DEV_APP_PORT:-8080}"
    backend_port="${DEV_API_PORT:-8787}"
    database_port="${DEV_DB_PORT:-5432}"
    database_name="${POSTGRES_DB:-school_ai_search_dev}"
    database_user="${POSTGRES_USER:-schoolapp}"

    cat <<EOF

Application locations for $environment_label:
  Frontend: http://127.0.0.1:$frontend_port
  Backend API: http://127.0.0.1:$backend_port
  Backend health check: http://127.0.0.1:$backend_port/api/health
  PostgreSQL database: 127.0.0.1:$database_port
  Database name: $database_name
  Database user: $database_user

Development runs Vite on the frontend port and the local Node backend on the API port.
EOF
  fi
}

run_command() {
  command="$1"

  case "$command" in
  build)
    compose build
    show_endpoints
    ;;
  rebuild)
    compose build --no-cache
    show_endpoints
    ;;
  start)
    compose up --build -d
    show_endpoints
    ;;
  stop)
    compose stop
    ;;
  restart)
    compose stop
    compose up --build -d
    show_endpoints
    ;;
  delete)
    if confirm_delete; then
      compose down --volumes --remove-orphans
    fi
    ;;
  status)
    compose ps
    ;;
  logs)
    compose logs -f
    ;;
  endpoints)
    show_endpoints
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    printf 'Unknown command: %s\n\n' "$command" >&2
    usage
    exit 1
    ;;
  esac
}

choose_environment() {
  while :; do
    print_menu
    choice="$(prompt "Environment number: ")"

    case "$choice" in
      1)
        set_environment prod
        return 0
        ;;
      2)
        set_environment dev
        return 0
        ;;
      0)
        exit 0
        ;;
      *)
        printf 'Please choose 1, 2, or 0.\n'
        ;;
    esac
  done
}

interactive_menu() {
  choose_environment

  while :; do
    printf '\nCurrent environment: %s\n' "$environment_label"
    print_action_menu
    action="$(prompt "Action number: ")"

    case "$action" in
      1)
        run_command build
        ;;
      2)
        run_command rebuild
        ;;
      3)
        run_command start
        ;;
      4)
        run_command stop
        ;;
      5)
        run_command restart
        ;;
      6)
        run_command delete
        ;;
      7)
        run_command status
        ;;
      8)
        run_command logs
        ;;
      9)
        run_command endpoints
        ;;
      10)
        choose_environment
        ;;
      0)
        exit 0
        ;;
      *)
        printf 'Please choose a number from 0 to 10.\n'
        ;;
    esac
  done
}

if [ "$#" -eq 0 ]; then
  interactive_menu
fi

command="${1:-help}"
environment="${2:-prod}"
set_environment "$environment"
run_command "$command"
