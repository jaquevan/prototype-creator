#!/bin/bash
# Bootstrap Beau Morley's consistency-checker guidelines and scripts into .context/.
# Sparse-clones only guidelines/ and scripts/ from the repo.
# Requires VPN + GitLab SSH access to gitlab.cee.redhat.com.

set -euo pipefail

CONTEXT_DIR=".context/consistency-checker"
CHECKER_REPO="git@gitlab.cee.redhat.com:bmorley/consistency-checker.git"

echo "Bootstrapping consistency-checker..."

mkdir -p "$CONTEXT_DIR"

if [ ! -d "$CONTEXT_DIR/.git" ]; then
    git clone --depth 1 --filter=blob:none --no-checkout "$CHECKER_REPO" "$CONTEXT_DIR" 2>/dev/null || {
        echo "Warning: Could not clone consistency-checker (VPN/SSH required). Design consistency checks will be unavailable."
        exit 0
    }
fi

cd "$CONTEXT_DIR"
git sparse-checkout init --cone 2>/dev/null || true
git sparse-checkout set guidelines scripts requirements.txt requirements-visual.txt 2>/dev/null || true
git checkout 2>/dev/null || true

echo "Consistency-checker bootstrapped to $CONTEXT_DIR"
echo "  Guidelines: $CONTEXT_DIR/guidelines/"
echo "  Scripts:    $CONTEXT_DIR/scripts/"
