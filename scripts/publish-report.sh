#!/usr/bin/env bash
set -euo pipefail

# Publish an evaluation report to GitLab Pages (or a reports branch as fallback).
# Overwrites the report at the same URL if re-run for the same prototype.
#
# Usage:
#   bash scripts/publish-report.sh .artifacts/RHAISTRAT-1536/
#   bash scripts/publish-report.sh .artifacts/RHAISTRAT-1536/ --mode=branch

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/publish.yaml"
INDEX_TEMPLATE="$PROJECT_ROOT/templates/report-index.html"

# ── Parse arguments ──────────────────────────────────────────────────────────

ARTIFACTS_DIR=""
MODE=""

for arg in "$@"; do
  case "$arg" in
    --mode=*) MODE="${arg#--mode=}" ;;
    -*) echo "Unknown flag: $arg" >&2; exit 1 ;;
    *) ARTIFACTS_DIR="$arg" ;;
  esac
done

if [[ -z "$ARTIFACTS_DIR" ]]; then
  echo "Usage: publish-report.sh <artifacts-dir> [--mode=pages|branch]" >&2
  echo "  e.g. publish-report.sh .artifacts/RHAISTRAT-1536/" >&2
  exit 1
fi

ARTIFACTS_DIR="$(cd "$ARTIFACTS_DIR" && pwd)"
REPORT_FILE="$ARTIFACTS_DIR/evaluation-report.html"

if [[ ! -f "$REPORT_FILE" ]]; then
  echo "Error: No evaluation-report.html found in $ARTIFACTS_DIR" >&2
  exit 1
fi

# ── Read config ──────────────────────────────────────────────────────────────

read_yaml_value() {
  local key="$1"
  grep "^${key}:" "$CONFIG_FILE" 2>/dev/null | sed 's/^[^:]*: *"\{0,1\}\([^"]*\)"\{0,1\}/\1/' || echo ""
}

GITLAB_PAGES_REPO="${GITLAB_PAGES_REPO:-$(read_yaml_value gitlab_pages_repo)}"
PAGES_BASE_URL="${PAGES_BASE_URL:-$(read_yaml_value pages_base_url)}"
PAGES_BRANCH="${PAGES_BRANCH:-$(read_yaml_value pages_branch)}"
REPORTS_DIR="${REPORTS_DIR:-$(read_yaml_value reports_dir)}"
JIRA_BASE_URL="${JIRA_BASE_URL:-$(read_yaml_value jira_base_url)}"
DEFAULT_MODE="$(read_yaml_value default_mode)"
BRANCH_REMOTE="$(read_yaml_value branch_remote)"
BRANCH_NAME="$(read_yaml_value branch_name)"
GIT_USER_NAME="${GIT_USER_NAME:-$(read_yaml_value git_user_name)}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-$(read_yaml_value git_user_email)}"

MODE="${MODE:-$DEFAULT_MODE}"

# Extract prototype key from directory name (e.g., RHAISTRAT-1536)
PROTO_KEY="$(basename "$ARTIFACTS_DIR")"

# ── Temp workspace ───────────────────────────────────────────────────────────

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# ── Mode: GitLab Pages ───────────────────────────────────────────────────────

publish_pages() {
  echo "Publishing to GitLab Pages..."

  if [[ -z "$GITLAB_PAGES_REPO" ]]; then
    echo "Error: Pages repo not configured (set GITLAB_PAGES_REPO env var or config/publish.yaml)" >&2
    exit 1
  fi

  local BRANCH="${PAGES_BRANCH:-main}"
  local RDIR="${REPORTS_DIR:-public/evals}"

  # Shallow clone the target branch
  git clone --depth 1 --branch "$BRANCH" "$GITLAB_PAGES_REPO" "$WORK_DIR/pages-repo" 2>/dev/null

  local REPORTS_PATH="$WORK_DIR/pages-repo/$RDIR"
  mkdir -p "$REPORTS_PATH/$PROTO_KEY"

  # Copy report as index.html (clean URLs)
  cp "$REPORT_FILE" "$REPORTS_PATH/$PROTO_KEY/index.html"

  # Regenerate the index page
  generate_index "$REPORTS_PATH"

  # Commit and push
  cd "$WORK_DIR/pages-repo"
  git add -A
  if git diff --cached --quiet; then
    echo "No changes to publish (report unchanged)."
  else
    git \
      -c user.name="${GIT_USER_NAME:-Evan Jaquez}" \
      -c user.email="${GIT_USER_EMAIL:-ejaquez@redhat.com}" \
      commit -m "Update eval report: $PROTO_KEY ($(date +%Y-%m-%d))"
    git push origin "$BRANCH"
    echo "Published successfully."
  fi

  local REPORT_URL="${PAGES_BASE_URL}/evals/${PROTO_KEY}/"
  echo "$REPORT_URL" > "$ARTIFACTS_DIR/report-url.txt"
  echo "$REPORT_URL"
}

# ── Mode: Reports branch ────────────────────────────────────────────────────

publish_branch() {
  echo "Publishing to reports branch..."

  local REMOTE="${BRANCH_REMOTE:-origin}"
  local BRANCH="${BRANCH_NAME:-reports}"

  cd "$PROJECT_ROOT"

  # Fetch the branch (create orphan if it doesn't exist)
  git fetch "$REMOTE" "$BRANCH" 2>/dev/null || true

  # Set up worktree for the reports branch
  local BRANCH_DIR="$WORK_DIR/reports-branch"

  if git rev-parse --verify "$REMOTE/$BRANCH" >/dev/null 2>&1; then
    git worktree add "$BRANCH_DIR" "$REMOTE/$BRANCH" 2>/dev/null
  else
    # Create orphan branch
    git worktree add --detach "$BRANCH_DIR" 2>/dev/null
    cd "$BRANCH_DIR"
    git checkout --orphan "$BRANCH"
    git rm -rf . 2>/dev/null || true
    echo "# Evaluation Reports" > README.md
    git add README.md
    git \
      -c user.name="${GIT_USER_NAME:-Evan Jaquez}" \
      -c user.email="${GIT_USER_EMAIL:-ejaquez@redhat.com}" \
      commit -m "Initialize reports branch"
  fi

  cd "$BRANCH_DIR"
  mkdir -p "evals/$PROTO_KEY"
  cp "$REPORT_FILE" "evals/$PROTO_KEY/index.html"

  # Regenerate index
  generate_index "$BRANCH_DIR/evals"

  git add -A
  if git diff --cached --quiet; then
    echo "No changes to publish (report unchanged)."
  else
    git \
      -c user.name="${GIT_USER_NAME:-Evan Jaquez}" \
      -c user.email="${GIT_USER_EMAIL:-ejaquez@redhat.com}" \
      commit -m "Update eval report: $PROTO_KEY ($(date +%Y-%m-%d))"
    git push "$REMOTE" HEAD:"$BRANCH"
    echo "Published successfully."
  fi

  # Clean up worktree
  cd "$PROJECT_ROOT"
  git worktree remove "$BRANCH_DIR" 2>/dev/null || true

  # Construct raw file URL (GitLab format)
  local RAW_URL="${GITLAB_PAGES_REPO%.git}/-/raw/${BRANCH}/evals/${PROTO_KEY}/index.html"
  # Convert SSH URL to HTTPS for raw access
  RAW_URL="$(echo "$RAW_URL" | sed 's|git@\([^:]*\):|https://\1/|')"
  echo "$RAW_URL" > "$ARTIFACTS_DIR/report-url.txt"
  echo "$RAW_URL"
}

# ── Index page generation ────────────────────────────────────────────────────

generate_index() {
  local EVALS_DIR="$1"
  local INDEX_FILE="$EVALS_DIR/index.html"
  local ROWS_FILE
  ROWS_FILE="$(mktemp)"

  # Scan for reports and build table rows
  for report_dir in "$EVALS_DIR"/*/; do
    [[ -f "$report_dir/index.html" ]] || continue
    local key
    key="$(basename "$report_dir")"
    [[ "$key" == "." || "$key" == ".." ]] && continue

    local eval_date
    eval_date="$(date -r "$report_dir/index.html" +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)"

    local title=""
    title="$(grep -o '<title>[^<]*</title>' "$report_dir/index.html" 2>/dev/null | head -1 | sed 's/<[^>]*>//g' || echo "")"
    [[ -z "$title" ]] && title="$key"

    echo "<tr><td><a href=\"${key}/\">${key}</a></td><td>${title}</td><td>${eval_date}</td><td><a href=\"${JIRA_BASE_URL}/${key}\" target=\"_blank\">Jira</a></td></tr>" >> "$ROWS_FILE"
  done

  # Build the index by writing head, inserting rows, writing tail
  if [[ -f "$INDEX_TEMPLATE" ]]; then
    # Split template at {{REPORT_ROWS}} marker and concatenate with rows
    sed '/{{REPORT_ROWS}}/,$d' "$INDEX_TEMPLATE" > "$INDEX_FILE"
    cat "$ROWS_FILE" >> "$INDEX_FILE"
    sed '1,/{{REPORT_ROWS}}/d' "$INDEX_TEMPLATE" >> "$INDEX_FILE"
  else
    cat > "$INDEX_FILE" <<'INDEXEOF'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Evaluation Reports</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.5rem; border-bottom: 2px solid #e0e0e0; padding-bottom: 0.5rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.6rem 0.8rem; border-bottom: 1px solid #eee; }
  th { background: #f5f5f5; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.03em; }
  tr:hover { background: #f9f9f9; }
  a { color: #0066cc; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .meta { color: #666; font-size: 0.85rem; margin-top: 0.5rem; }
</style>
</head>
<body>
<h1>Evaluation Reports</h1>
<p class="meta">Auto-generated by prototype-creator. Reports update in-place when re-evaluated.</p>
<table>
<thead><tr><th>Prototype</th><th>Title</th><th>Last Updated</th><th>Jira</th></tr></thead>
<tbody>
INDEXEOF
    cat "$ROWS_FILE" >> "$INDEX_FILE"
    cat >> "$INDEX_FILE" <<'INDEXEOF'
</tbody>
</table>
</body>
</html>
INDEXEOF
  fi

  rm -f "$ROWS_FILE"
}

# ── Dispatch ─────────────────────────────────────────────────────────────────

case "$MODE" in
  pages)  publish_pages ;;
  branch) publish_branch ;;
  *)
    echo "Error: Unknown mode '$MODE'. Use --mode=pages or --mode=branch" >&2
    exit 1
    ;;
esac
