#!/usr/bin/env bash
# Deploys origin/main to the server. Aborts instead of deploying a stale or locally modified checkout.
set -euo pipefail

TARGET="${1:-${PROD_SSH_TARGET:-}}"
REMOTE_DIR="${2:-${PROD_REMOTE_DIR:-/opt/ernaehrungstagebuch}}"

if [[ -z "$TARGET" ]]; then
  echo "Aufruf: $0 <user@host> [remote-dir]" >&2
  echo "Beispiel: $0 admin@wiegehts.x73.eu /opt/ernaehrungstagebuch" >&2
  exit 1
fi

# Remote part runs in bash explicitly: the login shell on the server may be sh
ssh "$TARGET" "bash -s -- $(printf '%q' "$REMOTE_DIR")" <<'REMOTE'
set -euo pipefail

fail() {
  echo "ABBRUCH: $*" >&2
  exit 1
}

cd "$1" 2>/dev/null || fail "Verzeichnis $1 existiert nicht"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "$1 ist kein Git-Repository"

branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" == "main" ]] || fail "Server steht auf Branch '$branch' statt 'main'"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  git status --short --untracked-files=no >&2
  fail "Lokale Änderungen auf dem Server"
fi

grep -q '^APP_PASSWORD=.' .env 2>/dev/null \
  || fail ".env mit APP_PASSWORD fehlt (siehe deployment/admin-anleitung.md)"

git fetch --prune origin
git merge --ff-only origin/main || fail "Kein Fast-Forward auf origin/main möglich"

echo "Deploye: $(git log -1 --oneline)"
docker compose up --build -d
docker compose ps
REMOTE
