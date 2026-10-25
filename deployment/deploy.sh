#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-${PROD_SSH_TARGET:-}}"
REMOTE_DIR="${2:-${PROD_REMOTE_DIR:-/opt/ernaehrungstagebuch}}"

if [[ -z "$TARGET" ]]; then
  echo "Usage: ./deploy.sh <user@host> [remote-dir]"
  echo "Example: ./deploy.sh deploy@wiegehts.x73.eu /opt/ernaehrungstagebuch"
  exit 1
fi

ssh "$TARGET" "set -euo pipefail; mkdir -p '$REMOTE_DIR'; cd '$REMOTE_DIR'; git rev-parse --is-inside-work-tree >/dev/null; git fetch --all --prune; if [ \"\$(git rev-parse --abbrev-ref HEAD)\" != 'main' ]; then echo 'ERROR: Remote repository is not on main branch. Switching to main is required.'; git checkout main; fi; git diff --quiet && git diff --cached --quiet; git pull --ff-only origin main; git status --short --branch; docker compose up --build -d; docker compose ps"
