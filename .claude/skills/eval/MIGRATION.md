# Migration Guide

How to copy the eval pipeline to another repository (e.g., UXD AI helpers).

## What Travels

The eval skill is fully self-contained. Copy the entire `.claude/skills/eval/` directory:

```
.claude/skills/eval/
  ├── eval-iterate/SKILL.md
  ├── eval-extract/SKILL.md
  ├── eval-classify/SKILL.md
  ├── eval-verify/SKILL.md
  ├── eval-discover/SKILL.md
  ├── eval-nav-context/SKILL.md
  ├── eval-consistency/SKILL.md
  ├── eval-fix/SKILL.md
  ├── eval-report/SKILL.md
  ├── eval-review/SKILL.md
  ├── scripts/
  │   ├── render-report.js
  │   ├── eval_state.py
  │   ├── log-run.js
  │   ├── sync-sheet.js
  │   ├── publish-report.sh
  │   ├── compare-ground-truth.js
  │   ├── compare-runs.js
  │   ├── build-leaderboard.js
  │   ├── append-iteration-log.js
  │   ├── validate-verdicts.js
  │   ├── validate-artifacts.js
  │   ├── hydrate-persona-results.js (deprecated)
  │   ├── generate-dashboard.js
  │   ├── resolve-root.js
  │   ├── bootstrap-consistency-checker.sh
  │   └── bootstrap-usability-testing.sh
  ├── config/
  │   ├── csv-schema.yaml
  │   ├── eval-settings.yaml
  │   ├── product-overlay.yaml
  │   ├── publish.yaml
  │   └── report-style.yaml
  ├── templates/
  │   ├── evaluation-report.html
  │   └── report-index.html
  ├── references/
  │   ├── phase-a-cli-workflow.md
  │   └── skill-overlays.md
  ├── gitlab-pages/
  │   ├── .gitlab-ci.yml
  │   ├── README.md
  │   └── public/evals/.gitkeep
  ├── tests/
  │   └── fixtures/
  │       ├── manifest.json
  │       ├── audio/
  │       ├── documents/
  │       ├── images/
  │       └── text/
  ├── package.json
  ├── README.md
  └── MIGRATION.md (this file)
```

## Dependencies

The eval skill includes its own `package.json`. In the target repo, install from the eval directory:

```bash
cd .claude/skills/eval
npm install
npx playwright install chromium
```

## Context Bootstrap

The eval pipeline requires `.context/` directories for usability scoring and consistency checking:

```bash
bash .claude/skills/eval/scripts/bootstrap-usability-testing.sh
bash .claude/skills/eval/scripts/bootstrap-consistency-checker.sh
```

These clone external repos into `.context/usability-testing/` and `.context/consistency-checker/`. Requires VPN for GitLab repos.

## What to Change

### Product Overlay

Edit `config/product-overlay.yaml` (relative to the eval skill root) to match the target product:
- Jira project key prefix (e.g., `RHAISTRAT` -> your project)
- Prototype repo URL
- MR numbering scheme
- Persona selection mapping (which personas match which audience)

### Publish Configuration

Edit `config/publish.yaml` (relative to the eval skill root):
- `gitlab_pages_repo` — your GitLab Pages repo URL
- `pages_base_url` — your Pages domain
- `jira_base_url` — your Jira instance

### Google Sheet Sync

In `.claude/skills/eval/scripts/sync-sheet.js`:
- Update `SPREADSHEET_ID` to your sheet
- Update `groundTruth` object with your designer verdicts
- Requires `gcloud auth login --enable-gdrive-access`

## What Stays Behind

These are prototype-creator specific and do NOT travel:

- `.claude/skills/prototype-*` (all prototype creation/refinement skills)
- `scripts/fetch_rfe.py`, `scripts/generate-report.py`, etc. (Andy's scripts)
- `scripts/frontmatter.py`, `scripts/resolve_workspace.py`, etc.
- `.artifacts/` (generated output, gitignored)
- `.context/` (bootstrapped at runtime, gitignored)

## Verification After Copy

```bash
# Verify scripts run
node .claude/skills/eval/scripts/render-report.js --help 2>&1 | head -1
python3 .claude/skills/eval/scripts/eval_state.py --help 2>&1 | head -1

# Verify context bootstrap
bash .claude/skills/eval/scripts/bootstrap-usability-testing.sh
ls .context/usability-testing/personas/

# Run a test eval
/eval-iterate YOUR-KEY-123 http://localhost:3000 --workspace=/path/to/prototype
```

## Composability Notes

The eval pipeline is product-agnostic by design:
- Jira keys are passed as arguments, not hardcoded
- Personas are selected dynamically based on ticket audience
- Consistency checks use `.context/consistency-checker/` guidelines (swappable)
- The report template works for any prototype with ACs

To adapt for a different design system (not PatternFly), swap the consistency checker context and update the guideline references in `eval-consistency/SKILL.md`.
