#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-$PWD}"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "ERROR: $REPO_DIR is not a git repository."
  exit 1
fi

cd "$REPO_DIR"

git fetch --all --prune

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "ERROR: Current branch is $CURRENT_BRANCH. Switch to main before editing or deploying."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: Working tree is dirty. Commit or stash changes before continuing."
  exit 1
fi

git pull --ff-only origin main

echo "Repository is synchronized with origin/main."
