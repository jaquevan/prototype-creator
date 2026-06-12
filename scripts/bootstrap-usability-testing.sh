#!/bin/bash
# Bootstrap automated-usability-testing personas and rubric into .context/ for evaluation integration.

set -euo pipefail

CONTEXT_DIR=".context/usability-testing"
USABILITY_REPO="https://gitlab.cee.redhat.com/zbodnar/automated-usability-testing.git"

echo "Bootstrapping automated-usability-testing..."

mkdir -p "$CONTEXT_DIR"

if [ ! -d "$CONTEXT_DIR/.git" ]; then
    git clone --depth 1 --filter=blob:none --sparse "$USABILITY_REPO" "$CONTEXT_DIR" 2>/dev/null || {
        echo "Warning: Could not clone automated-usability-testing. Usability dimension scoring will be unavailable."
        exit 0
    }
fi

cd "$CONTEXT_DIR"
git sparse-checkout set personas prompts tools 2>/dev/null || true

echo "Automated-usability-testing bootstrapped to $CONTEXT_DIR"
