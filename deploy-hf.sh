#!/usr/bin/env sh
set -eu

PREFIX="relay-server"
REMOTE="hf"
BRANCH="${1:-main}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: must run inside a git repository." >&2
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "Error: git remote '$REMOTE' not found." >&2
  echo "Add it with: git remote add hf https://huggingface.co/spaces/<org>/<space>" >&2
  exit 1
fi

if [ ! -d "$PREFIX" ]; then
  echo "Error: '$PREFIX/' directory not found." >&2
  exit 1
fi

echo "Deploying '$PREFIX/' to '$REMOTE/$BRANCH' via git subtree..."
git subtree push --prefix "$PREFIX" "$REMOTE" "$BRANCH"
