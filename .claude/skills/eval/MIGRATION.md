# Migration Guide

How to copy the eval pipeline to another repository (e.g., UXD AI helpers).

## What Travels

```
.claude/skills/eval/              # All skills + scripts + README
  ├── eval-iterate/SKILL.md
  ├── eval-extract/SKILL.md
  ├── eval-classify/SKILL.md
  ├── eval-journey/SKILL.md
  ├── eval-usability/SKILL.md
  ├── eval-consistency/SKILL.md
  ├── eval-hint/SKILL.md
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
  │   ├── bootstrap-consistency-checker.sh
  │   └── bootstrap-usability-testing.sh
  ├── README.md
  └── MIGRATION.md (this file)

templates/
  ├── evaluation-report.html
  └── report-index.html

config/
  ├── csv-schema.yaml
  ├── publish.yaml
  └── report-style.yaml
```

## Dependencies

Add to `package.json` in the target repo:

```json
{
  "dependencies": {
    "@playwright/test": "^1.61.0",
    "googleapis": "^173.0.0"
  }
}
```

Then run:
```bash
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

Edit `config/product-overlay.yaml` to match the target product:
- Jira project key prefix (e.g., `RHAISTRAT` -> your project)
- Prototype repo URL
- MR numbering scheme
- Persona selection mapping (which personas match which audience)

### Publish Configuration

Edit `config/publish.yaml`:
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
