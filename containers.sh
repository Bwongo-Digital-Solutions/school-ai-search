#!/usr/bin/env sh
set -eu

APP_NAME="school-ai-search"
PROD_COMPOSE_FILE="docker-compose.yml"
DEV_COMPOSE_FILE="docker-compose.dev.yml"

# Which reverse proxy fronts the app: none, nginx or caddy. Each is a compose profile, so the
# default stays exactly the stack this script has always started.
proxy="${PROXY:-none}"

# Where nginx reads its certificate from, and where certbot writes one.
CERT_DIR="deploy/nginx/certs"

usage() {
  cat <<'EOF'
School AI Search container helper

Usage:
  ./containers.sh <command> [environment]
  ./containers.sh

Commands:
  build         Build the app image and services
  rebuild       Build the app image and services without Docker cache
  start         Start containers in the background
  stop          Stop containers without deleting data
  restart       Stop and start containers
  delete        Stop containers and delete project volumes
  status        Show container status
  logs          Follow container logs
  endpoints     Show application URLs and ports

TLS / reverse proxy (production only):
  cert-status   Show which certificate is in place and when it expires
  cert-bootstrap Write a self-signed placeholder so nginx can start before the real one exists
  cert-issue    Obtain a wildcard certificate with certbot (DNS-01)
  cert-install  Copy the issued certificate in for nginx and reload it
  cert-renew    Renew, reinstall and reload in one step
  proxy-reload  Re-read the proxy configuration without dropping connections

Environments:
  prod       Production stack from docker-compose.yml (default)
  dev        Live-reload stack from docker-compose.dev.yml

Reverse proxy (PROXY env, or the interactive menu):
  none       Publish the app directly on 127.0.0.1:8787 (default)
  nginx      Terminate TLS with nginx, using a certificate you issue
  caddy      Terminate TLS with Caddy, which issues and renews it itself

Examples:
  ./containers.sh build
  ./containers.sh start prod
  PROXY=nginx ./containers.sh start        # start the app behind nginx
  PROXY=caddy ./containers.sh start        # start the app behind Caddy
  ./containers.sh cert-issue               # wildcard certificate for *.eschool.ink
  ./containers.sh cert-renew
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
  cat <<EOF

Current environment: $environment_label
Reverse proxy: $proxy

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
 10) Choose reverse proxy (none / nginx / caddy)
 11) Certificate status
 12) Issue a wildcard certificate (nginx)
 13) Renew the certificate and reload
 14) Reload the proxy configuration
 15) Write a self-signed placeholder so nginx can start
 16) Change environment
  0) Exit
EOF
}

print_proxy_menu() {
  cat <<'EOF'

Which reverse proxy should front the app?
  1) None   — publish the app on 127.0.0.1:8787, no TLS
  2) nginx  — TLS with a certificate you issue (./containers.sh cert-issue)
  3) Caddy  — TLS with a certificate Caddy issues and renews itself
  0) Back
EOF
}

choose_proxy() {
  while :; do
    print_proxy_menu
    choice="$(prompt "Proxy number: ")"

    case "$choice" in
      1) set_proxy none;  return 0 ;;
      2) set_proxy nginx; return 0 ;;
      3) set_proxy caddy; return 0 ;;
      0) return 0 ;;
      *) printf 'Please choose 1, 2, 3, or 0.\n' ;;
    esac
  done
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
      env_file=".env.production"
      ;;
    dev)
      compose_file="$DEV_COMPOSE_FILE"
      project_name="$APP_NAME-dev"
      environment_label="Development"
      env_file=".env.development"
      ;;
    *)
      printf 'Unknown environment: %s\n\n' "$environment" >&2
      usage
      exit 1
      ;;
  esac

  # Re-check the proxy against the environment just chosen: PROXY from the environment, or a proxy
  # picked before switching to dev, would otherwise skip the production-only guard in set_proxy.
  set_proxy "$proxy"
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

# The proxy is a compose profile. COMPOSE_PROFILES rather than the --profile flag because the v1
# standalone (docker-compose) reads the variable but does not take the flag, and this script
# supports both.
compose_profiles() {
  case "$proxy" in
    nginx) printf 'proxy-nginx' ;;
    caddy) printf 'proxy-caddy' ;;
    *)     printf '' ;;
  esac
}

# Which file supplies the ${VARIABLES} in the compose file.
#
# Compose only reads `.env` on its own. The documented template here is `.env.production`, so
# without this every secret in it — SESSION_SECRET, PLATFORM_OWNER_TOKEN, the whole control plane —
# silently interpolated to empty and the app came up unconfigured with no error anywhere.
env_file_args() {
  if [ -n "${env_file:-}" ] && [ -f "$env_file" ]; then
    printf -- '--env-file\n%s' "$env_file"
  elif [ -f ".env" ]; then
    printf -- '--env-file\n.env'
  fi
}

compose() {
  detect_compose

  # --env-file, -p and -f are all top-level flags and must come BEFORE the subcommand, so they are
  # prepended to the arguments this was called with. IFS is switched to a newline so only the
  # (possibly empty) --env-file pair is word-split; sh has no arrays to do this more tidily.
  old_ifs="$IFS"
  IFS='
'
  # shellcheck disable=SC2046,SC2086
  set -- $(env_file_args) -p "$project_name" -f "$compose_file" "$@"
  IFS="$old_ifs"

  # Unquoted on purpose: "docker compose" has to split into a command and its subcommand.
  # shellcheck disable=SC2086
  COMPOSE_PROFILES="$(compose_profiles)" $compose_bin "$@"
}

set_proxy() {
  case "$1" in
    none|nginx|caddy)
      proxy="$1"
      ;;
    *)
      printf 'Unknown proxy: %s (use none, nginx or caddy)\n' "$1" >&2
      exit 1
      ;;
  esac

  # docker-compose.dev.yml has no proxy services; development runs Vite directly.
  if [ "$proxy" != "none" ] && [ "${environment:-prod}" = "dev" ]; then
    printf 'The reverse proxy is production only; development is unchanged.\n' >&2
    proxy="none"
  fi
}

# Reads one setting out of .env.production, falling back to .env and then to the value already in
# the environment. Only the certificate commands need this; compose reads its own env file.
read_env_value() {
  key="$1"
  fallback="${2:-}"

  for file in .env.production .env; do
    if [ -f "$file" ]; then
      value="$(sed -n "s/^[[:space:]]*${key}=//p" "$file" | tail -n 1 | tr -d '\r' | sed 's/^"//; s/"$//')"
      if [ -n "$value" ]; then
        printf '%s' "$value"
        return 0
      fi
    fi
  done

  eval "value=\${${key}:-}"
  printf '%s' "${value:-$fallback}"
}

root_domain() {
  read_env_value TENANT_ROOT_DOMAIN eschool.ink
}

# certbot writes as root, and the certificates it writes are readable only by root.
as_root() {
  if [ "$(id -u)" = "0" ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    printf 'This needs root, and sudo is not installed. Run the script as root.\n' >&2
    exit 1
  fi
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

    if [ "$proxy" != "none" ]; then
      domain="$(root_domain)"
      cat <<EOF
Behind the $proxy reverse proxy, schools reach it over TLS instead:
  A school:             https://<school>.$domain
  Sign-up:              https://$domain/signup
  Operator console:     https://$domain/owner

The app port above stays on loopback; the proxy is the only way in from outside.
EOF
    fi
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

# --------------------------------------------------------------------------- certificates ------
#
# Every school is a subdomain, so the certificate has to be a wildcard — and a wildcard cannot be
# issued over the HTTP-01 challenge, because the ACME server has no single host to fetch a file
# from. It must be DNS-01, which means certbot needs an API token for the domain's DNS.
#
# Caddy does all of this by itself given CLOUDFLARE_API_TOKEN, so these commands are for nginx.

certbot_plugin() {
  read_env_value CERTBOT_DNS_PLUGIN dns-cloudflare
}

certbot_credentials() {
  read_env_value CERTBOT_DNS_CREDENTIALS /etc/letsencrypt/cloudflare.ini
}

live_dir() {
  printf '/etc/letsencrypt/live/%s' "$(root_domain)"
}

require_nginx_proxy() {
  case "$proxy" in
    caddy)
      cat <<EOF

Caddy obtains and renews its own certificate, so there is nothing to issue by hand.
It needs a DNS API token to answer the DNS-01 challenge for a wildcard — set ACME_EMAIL and
CLOUDFLARE_API_TOKEN in .env.production, then start the stack.

Watch it happen with:  ./containers.sh logs
EOF
      return 1
      ;;
    none)
      printf '\nNo reverse proxy is selected, so there is nothing to give a certificate to.\n' >&2
      printf 'Choose one first:  PROXY=nginx ./containers.sh %s\n' "$1" >&2
      return 1
      ;;
  esac
  return 0
}

cert_status() {
  domain="$(root_domain)"

  printf '\nCertificate status for %s and *.%s\n\n' "$domain" "$domain"

  if [ -f "$CERT_DIR/fullchain.pem" ]; then
    printf '  In place for nginx: %s/fullchain.pem\n' "$CERT_DIR"
    if command -v openssl >/dev/null 2>&1; then
      printf '  Expires:            %s\n' \
        "$(openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -enddate 2>/dev/null | cut -d= -f2)"
      printf '  Covers:             %s\n' \
        "$(openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -text 2>/dev/null \
           | sed -n '/Subject Alternative Name/{n;s/^ *//;p;}')"
    fi
  else
    printf '  In place for nginx: none (%s/fullchain.pem is missing)\n' "$CERT_DIR"
  fi

  if [ -d "$(live_dir)" ]; then
    printf '  Issued by certbot:  %s\n' "$(live_dir)"
  else
    printf '  Issued by certbot:  none — run ./containers.sh cert-issue\n'
  fi

  case "$proxy" in
    caddy) printf '\n  Proxy: caddy, which manages its own certificate — the above does not apply.\n' ;;
    nginx) printf '\n  Proxy: nginx, which reads the certificate from %s.\n' "$CERT_DIR" ;;
    *)     printf '\n  Proxy: none selected.\n' ;;
  esac
}

# nginx will not start at all when ssl_certificate points at a file that does not exist — it fails
# the config check and exits. On a fresh deployment that is a chicken-and-egg: no certificate means
# no nginx, and no nginx means the site is simply down rather than showing a warning.
#
# So a placeholder is written first. Browsers reject it loudly, which is correct — it exists only so
# nginx can boot and serve the ACME/redirect paths until the real certificate replaces it.
cert_bootstrap() {
  domain="$(root_domain)"

  if [ -f "$CERT_DIR/fullchain.pem" ]; then
    printf 'A certificate is already in place at %s — leaving it alone.\n' "$CERT_DIR"
    return 0
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    printf 'openssl is not installed, so a placeholder certificate cannot be generated.\n' >&2
    return 1
  fi

  mkdir -p "$CERT_DIR"
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
    -keyout "$CERT_DIR/privkey.pem" -out "$CERT_DIR/fullchain.pem" \
    -subj "/CN=$domain" \
    -addext "subjectAltName=DNS:$domain,DNS:*.$domain" >/dev/null 2>&1
  chmod 600 "$CERT_DIR/privkey.pem"

  cat <<EOF

Wrote a SELF-SIGNED placeholder certificate to $CERT_DIR.

nginx can now start, but every browser will warn that the certificate is not trusted — because it
is not. Replace it with a real one as soon as DNS points here:

  ./containers.sh cert-issue

EOF
}

cert_issue() {
  require_nginx_proxy cert-issue || return 0

  domain="$(root_domain)"
  plugin="$(certbot_plugin)"
  credentials="$(certbot_credentials)"

  if ! command -v certbot >/dev/null 2>&1; then
    cat >&2 <<EOF

certbot is not installed.

  Debian/Ubuntu:  sudo apt-get install certbot python3-certbot-$plugin
  RHEL/Fedora:    sudo dnf install certbot python3-certbot-$plugin

The DNS plugin matters: a wildcard needs the DNS-01 challenge, so certbot has to be able to write a
record in your DNS. Set CERTBOT_DNS_PLUGIN in .env.production for a provider other than Cloudflare.
EOF
    return 1
  fi

  if [ ! -f "$credentials" ]; then
    cat >&2 <<EOF

The DNS credentials file $credentials does not exist.

For Cloudflare it holds one line with a token that may edit this zone's DNS:

  dns_cloudflare_api_token = your-token-here

Create it, then:  sudo chmod 600 $credentials
Set CERTBOT_DNS_CREDENTIALS in .env.production to use a different path.
EOF
    return 1
  fi

  printf '\nRequesting a wildcard certificate for %s and *.%s ...\n\n' "$domain" "$domain"
  as_root certbot certonly \
    "--$plugin" \
    "--$plugin-credentials" "$credentials" \
    -d "$domain" -d "*.$domain"

  cert_install
}

cert_install() {
  require_nginx_proxy cert-install || return 0

  if [ ! -d "$(live_dir)" ]; then
    printf '\nNothing to install: %s does not exist. Run ./containers.sh cert-issue first.\n' "$(live_dir)" >&2
    return 1
  fi

  mkdir -p "$CERT_DIR"
  # -L because certbot's live/ entries are symlinks into archive/, and the container only mounts
  # this directory — a copied symlink would dangle inside it.
  as_root cp -L "$(live_dir)/fullchain.pem" "$CERT_DIR/fullchain.pem"
  as_root cp -L "$(live_dir)/privkey.pem" "$CERT_DIR/privkey.pem"
  as_root chmod 600 "$CERT_DIR/privkey.pem"
  as_root chmod 644 "$CERT_DIR/fullchain.pem"

  printf 'Certificate copied into %s.\n' "$CERT_DIR"
  proxy_reload
}

cert_renew() {
  require_nginx_proxy cert-renew || return 0

  if ! command -v certbot >/dev/null 2>&1; then
    printf '\ncertbot is not installed — see ./containers.sh cert-issue.\n' >&2
    return 1
  fi

  # certbot renews only what is close to expiry, so this is safe to run on a schedule.
  as_root certbot renew
  cert_install
}

proxy_reload() {
  case "$proxy" in
    nginx)
      # Validate before reloading: a bad config that is only caught on reload takes the site down.
      if compose exec -T nginx nginx -t; then
        compose exec -T nginx nginx -s reload
        printf 'nginx reloaded.\n'
      else
        printf 'nginx rejected the configuration; it was left running as it was.\n' >&2
        return 1
      fi
      ;;
    caddy)
      compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
      printf 'Caddy reloaded.\n'
      ;;
    *)
      printf 'No reverse proxy is selected, so there is nothing to reload.\n' >&2
      ;;
  esac
}

# Called before starting under the nginx profile. Without a readable certificate nginx exits on
# startup and the whole site is unreachable — including the plain-HTTP redirect — so this is the
# difference between "browser warning" and "nothing answers at all".
# Both proxies bind 80 and 443, so running them together leaves whichever lost the race in a crash
# loop — and it is easy to end up there by running the compose commands by hand for one profile and
# then the other. Starting one takes the other down.
stop_other_proxy() {
  detect_compose
  case "$proxy" in
    nginx) other="caddy" ;;
    caddy) other="nginx" ;;
    *)     return 0 ;;
  esac

  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$APP_NAME-$other"; then
    printf 'Stopping the %s proxy — both bind 80 and 443, so only one can run.\n' "$other"
    docker rm -f "$APP_NAME-$other" >/dev/null 2>&1 || true
  fi
}

ensure_startable_cert() {
  [ "$proxy" = "nginx" ] || return 0
  [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ] && return 0

  printf '\nNo certificate in %s, and nginx will not start without one.\n' "$CERT_DIR" >&2
  cert_bootstrap
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
    stop_other_proxy
    ensure_startable_cert
    compose up --build -d
    show_endpoints
    ;;
  stop)
    compose stop
    ;;
  restart)
    stop_other_proxy
    ensure_startable_cert
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
  cert-bootstrap)
    cert_bootstrap
    ;;
  cert-status)
    cert_status
    ;;
  cert-issue)
    cert_issue
    ;;
  cert-install)
    cert_install
    ;;
  cert-renew)
    cert_renew
    ;;
  proxy-reload)
    proxy_reload
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
        choose_proxy
        ;;
      11)
        run_command cert-status
        ;;
      12)
        run_command cert-issue
        ;;
      13)
        run_command cert-renew
        ;;
      14)
        run_command proxy-reload
        ;;
      15)
        run_command cert-bootstrap
        ;;
      16)
        choose_environment
        ;;
      0)
        exit 0
        ;;
      *)
        printf 'Please choose a number from 0 to 16.\n'
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
# ./containers.sh start prod nginx — the same as PROXY=nginx, for a cron line or a deploy script.
[ "$#" -ge 3 ] && set_proxy "$3"
run_command "$command"
