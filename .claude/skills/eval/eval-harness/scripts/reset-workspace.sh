#!/usr/bin/env bash
set -euo pipefail

# Usage: reset-workspace.sh <workspace-path> <branch> <commit>
# Resets the workspace to the exact commit used in the original eval run.
# Called by eval-harness before each test case that has workspace_reset: true.

WORKSPACE="${1:?Usage: reset-workspace.sh <workspace> <branch> <commit>}"
BRANCH="${2:?Missing branch}"
COMMIT="${3:?Missing commit}"

cd "$WORKSPACE"

# Stash any uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "Stashing uncommitted changes..."
  git stash push -m "eval-harness auto-stash before reset" --quiet
fi

# Switch to the correct branch
CURRENT=$(git branch --show-current)
if [ "$CURRENT" != "$BRANCH" ]; then
  echo "Switching from $CURRENT to $BRANCH..."
  git checkout "$BRANCH" --quiet
fi

# Reset to the exact commit
CURRENT_COMMIT=$(git rev-parse --short HEAD)
if [ "$CURRENT_COMMIT" != "$COMMIT" ]; then
  echo "Resetting to $COMMIT (was $CURRENT_COMMIT)..."
  git reset --hard "$COMMIT" --quiet
fi

echo "Workspace ready: $BRANCH @ $COMMIT"
echo "  Path: $WORKSPACE"
echo "  Status: $(git status --short | wc -l | tr -d ' ') uncommitted files"
