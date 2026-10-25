#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-${PROD_SSH_TARGET:-}}"
REMOTE_DIR="${2:-${PROD_REMOTE_DIR:-/opt/ernaehrungstagebuch}}"

if [[ -z "$TARGET" ]]; then
  echo "Usage: ./scripts/deploy.sh <user@host> [remote-dir]"
  echo "Example: ./scripts/deploy.sh deploy@wiegehts.x73.eu /opt/ernaehrungstagebuch"
  exit 1
fi

ssh "$TARGET" "mkdir -p '$REMOTE_DIR' && cd '$REMOTE_DIR' && git pull origin main && docker compose up --build -d && docker compose ps"
