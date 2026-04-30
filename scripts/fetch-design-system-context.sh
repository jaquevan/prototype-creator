#!/bin/bash
# Fetch PatternFly design system documentation for prototype generation context.
# Downloads component docs, design tokens, and layout guidelines.

set -euo pipefail

CONTEXT_DIR=".context/design-system"
PATTERNFLY_REPO="https://github.com/patternfly/patternfly-org"

echo "Fetching design system context..."

mkdir -p "$CONTEXT_DIR"

# Sparse checkout of PatternFly component docs
if [ ! -d "$CONTEXT_DIR/.git" ]; then
    git clone --depth 1 --filter=blob:none --sparse "$PATTERNFLY_REPO" "$CONTEXT_DIR" 2>/dev/null || {
        echo "Warning: Could not clone PatternFly docs. Prototype generation will proceed without design system context."
        exit 0
    }
fi

cd "$CONTEXT_DIR"
git sparse-checkout set packages/documentation-site/patternfly-docs/content/design-guidelines 2>/dev/null || true

echo "Design system context fetched to $CONTEXT_DIR"
