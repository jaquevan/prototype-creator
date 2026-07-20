#!/bin/bash
# Replaces eval-report and eval-generate-report SKILL.md files.
# Pure script invocation — no LLM reasoning needed.
#
# Usage: bash .claude/skills/eval/scripts/generate-report.sh <artifacts-dir> [--note="..."] [--open] [--leaderboard]

set -e

DIR="$1"
if [ -z "$DIR" ]; then
  echo "Usage: generate-report.sh <artifacts-dir> [--note='...'] [--open] [--leaderboard]"
  exit 1
fi

NOTE=""
OPEN=false
LEADERBOARD=false
for arg in "${@:2}"; do
  case "$arg" in
    --note=*) NOTE="${arg#--note=}" ;;
    --open) OPEN=true ;;
    --leaderboard) LEADERBOARD=true ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Step 1: Verify required artifacts exist
for f in evaluation-report.csv journey-log.json extract-state.json; do
  if [ ! -f "$DIR/$f" ]; then
    echo "ERROR: $DIR/$f not found"
    exit 1
  fi
done

# Step 2: Validate schemas
node "$SCRIPT_DIR/validate-artifacts.js" "$DIR/"

# Step 3: Render HTML report
node "$SCRIPT_DIR/render-report.js" "$DIR/"

# Step 4: Log run + archive
if [ -n "$NOTE" ]; then
  node "$SCRIPT_DIR/log-run.js" "$DIR/" --note="$NOTE"
else
  node "$SCRIPT_DIR/log-run.js" "$DIR/"
fi

# Step 5: Optional leaderboard rebuild
if [ "$LEADERBOARD" = true ]; then
  node "$SCRIPT_DIR/build-leaderboard.js" 2>/dev/null || true
fi

# Step 6: Confirm output
if [ ! -f "$DIR/evaluation-report.html" ]; then
  echo "ERROR: Report generation failed — evaluation-report.html not created"
  exit 1
fi

echo "✓ Report: $DIR/evaluation-report.html"

# Step 7: Optional open
if [ "$OPEN" = true ]; then
  open "$DIR/evaluation-report.html" 2>/dev/null || xdg-open "$DIR/evaluation-report.html" 2>/dev/null || true
fi
