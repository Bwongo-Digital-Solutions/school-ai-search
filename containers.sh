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
  start      Start containers in the background
  stop       Stop containers without deleting data
  restart    Stop and start containers
  delete     Stop containers and delete project volumes
  status     Show container status
  logs       Follow container logs

Environments:
  prod       Production stack from docker-compose.yml (default)
  dev        Live-reload stack from docker-compose.dev.yml

Examples:
  ./containers.sh build
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
  2) Start containers
  3) Stop containers
  4) Restart containers
  5) Delete containers and volumes
  6) Show container status
  7) Follow logs
  8) Change environment
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

compose() {
  docker compose -p "$project_name" -f "$compose_file" "$@"
}

run_command() {
  command="$1"

  case "$command" in
  build)
    compose build
    ;;
  start)
    compose up --build -d
    ;;
  stop)
    compose stop
    ;;
  restart)
    compose stop
    compose up --build -d
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
        run_command start
        ;;
      3)
        run_command stop
        ;;
      4)
        run_command restart
        ;;
      5)
        run_command delete
        ;;
      6)
        run_command status
        ;;
      7)
        run_command logs
        ;;
      8)
        choose_environment
        ;;
      0)
        exit 0
        ;;
      *)
        printf 'Please choose a number from 0 to 8.\n'
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
