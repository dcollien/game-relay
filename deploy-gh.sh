#!/usr/bin/env sh
set -eu

REMOTE="github"
BRANCH="${1:-main}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: must run inside a git repository." >&2
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "Error: git remote '$REMOTE' not found." >&2
  echo "Add it with: git remote add github git@github.com:<user>/<repo>.git" >&2
  exit 1
fi

echo "Pushing to '$REMOTE/$BRANCH'..."
git push "$REMOTE" "$BRANCH"
