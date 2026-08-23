#!/usr/bin/env bash
# Runs Meilisearch natively, for people not using Docker.
#
# Meilisearch is a separate server program, like PostgreSQL — the app talks to it over HTTP, so it
# has to be running for global search to work. Without it the app still works: ⌘K falls back to a
# basic student-name query and says so.
#
#   ./scripts/run-meilisearch.sh
#
# Downloads the binary on first run (~116MB) into .meilisearch/ beside the project, reads the key
# from .env.local so the app and the server always agree, and keeps its data in .meilisearch/data.
# Leave it running in its own terminal, then start the app as usual.
#
# Docker users want this instead:  docker compose --profile search up -d
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${MEILISEARCH_VERSION:-v1.11.3}"
INSTALL_DIR=".meilisearch"
BINARY="${INSTALL_DIR}/meilisearch-${VERSION}"

# The key must match what the app sends. Read it from .env.local rather than asking for it twice —
# a mismatch shows up as an unhelpful 403 from an otherwise healthy server.
if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
fi

KEY="${MEILISEARCH_API_KEY:-}"
if [ -z "$KEY" ]; then
  echo "MEILISEARCH_API_KEY is not set in .env.local."
  echo "Add one (any long random string) and re-run:"
  echo
  echo "  echo \"MEILISEARCH_API_KEY=\$(head -c 32 /dev/urandom | base64 | tr -d '/+=')\" >> .env.local"
  exit 1
fi

# Port comes from MEILISEARCH_HOST when it names one, so a custom host in .env.local is honoured.
PORT="$(printf '%s' "${MEILISEARCH_HOST:-http://127.0.0.1:7700}" | sed -E 's#.*:([0-9]+)/?$#\1#')"
case "$PORT" in ''|*[!0-9]*) PORT=7700 ;; esac

mkdir -p "$INSTALL_DIR/data"

if [ ! -x "$BINARY" ]; then
  case "$(uname -m)" in
    x86_64)          ASSET="meilisearch-linux-amd64" ;;
    aarch64|arm64)   ASSET="meilisearch-linux-aarch64" ;;
    *) echo "Unsupported architecture: $(uname -m). Install Meilisearch manually." >&2; exit 1 ;;
  esac

  URL="https://github.com/meilisearch/meilisearch/releases/download/${VERSION}/${ASSET}"
  echo "Downloading Meilisearch ${VERSION} (~116MB, first run only)…"

  # -C - resumes a part-finished download: this file is large enough that a dropped connection is
  # common, and a truncated binary segfaults with no useful message.
  curl -fL --retry 5 --retry-all-errors -C - --progress-bar -o "${BINARY}.part" "$URL"

  EXPECTED="$(curl -sIL "$URL" | grep -i '^content-length' | tail -1 | tr -dc '0-9')"
  ACTUAL="$(stat -c%s "${BINARY}.part")"
  if [ -n "$EXPECTED" ] && [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "Download incomplete: got ${ACTUAL} bytes, expected ${EXPECTED}. Re-run to resume." >&2
    exit 1
  fi

  chmod +x "${BINARY}.part"
  mv "${BINARY}.part" "$BINARY"
  echo "Installed to ${BINARY}"
fi

echo "Meilisearch listening on http://127.0.0.1:${PORT} — leave this running."
echo "Then, in the app: Settings -> Search & LibreChat -> Rebuild search index."
echo

exec "$BINARY" \
  --http-addr "127.0.0.1:${PORT}" \
  --master-key "$KEY" \
  --db-path "${INSTALL_DIR}/data" \
  --no-analytics
