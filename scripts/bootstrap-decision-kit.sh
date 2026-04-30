#!/bin/bash
# Bootstrap decision-kit thinking skills into .context/ for decide mode integration.

set -euo pipefail

CONTEXT_DIR=".context/decision-kit"
DECISION_KIT_REPO="https://github.com/jnemargut/decision-kit"

echo "Bootstrapping decision-kit..."

mkdir -p "$CONTEXT_DIR"

if [ ! -d "$CONTEXT_DIR/.git" ]; then
    git clone --depth 1 --filter=blob:none --sparse "$DECISION_KIT_REPO" "$CONTEXT_DIR" 2>/dev/null || {
        echo "Warning: Could not clone decision-kit. Decide mode will use built-in decision prompts instead."
        exit 0
    }
fi

cd "$CONTEXT_DIR"
git sparse-checkout set thinking SPEC.md 2>/dev/null || true

echo "Decision-kit bootstrapped to $CONTEXT_DIR"
