---
name: eval-report
description: Generate the self-contained HTML evaluation report from pipeline artifacts. Thin wrapper around render-report.js and log-run.js.
user-invocable: false
allowed-tools: Read, Bash, Glob
---

# eval-report

Phase 4 of the eval pipeline. Renders the final HTML report from JSON/CSV artifacts produced by earlier phases.

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `.artifacts/<KEY>/evaluation-report.csv` | AC verdicts (Section 1) + usability dimensions (Section 2) | Yes |
| `.artifacts/<KEY>/journey-log.json` | Playwright step log with screenshots and usability overlays | Yes |
| `.artifacts/<KEY>/screenshots/` | Journey step screenshots (embedded as base64) | Yes |
| `.artifacts/<KEY>/consistency-report.json` | PatternFly design violations | No |
| `.artifacts/<KEY>/outcome-context.json` | Parent Outcome ticket context for breadcrumb | No |
| `.artifacts/<KEY>/extract-state.json` | Breadcrumb, persona selection (for report header) | Yes |
| `.artifacts/<KEY>/iteration-log.json` | Cross-iteration pass/fail counts (if iterating) | No |
| `--note` | Description string for the run log entry | No |

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/evaluation-report.html` | Self-contained HTML report with embedded screenshots |
| `.artifacts/<KEY>/evaluation-summary.json` | Agent-readable summary: AC verdicts, usability scores, counts, iteration state |
| `.artifacts/runs/run-log.csv` | Appended run entry for cross-run tracking |

## Procedure

### Step 1: Verify artifacts exist

Before rendering, confirm the minimum required files are present:

```bash
KEY="<jira-key>"
ARTIFACTS_DIR=".artifacts/$KEY"

# Required
test -f "$ARTIFACTS_DIR/evaluation-report.csv" || { echo "ERROR: evaluation-report.csv missing"; exit 1; }
test -f "$ARTIFACTS_DIR/journey-log.json" || { echo "ERROR: journey-log.json missing"; exit 1; }
test -f "$ARTIFACTS_DIR/extract-state.json" || { echo "ERROR: extract-state.json missing"; exit 1; }
```

If any required file is missing, stop and report which file is absent. The upstream phase that produces it likely failed.

### Step 1b: Validate artifact schemas (BLOCKING)

Before rendering, validate all artifact JSON files against the schemas render-report.js expects:

```bash
node .claude/skills/eval/scripts/validate-artifacts.js .artifacts/$KEY/
```

If any violations are found, fix them before proceeding. The script prints specific fix instructions for each violation.

**Note:** `render-report.js` also auto-normalizes common schema drift (absolute screenshot paths, missing step counts, dimension ID aliases, flat dimension scores) via `normalizeJourneyLog` and `normalizeUsabilityDimensions`. But the validation script catches issues normalization can't fix.

### Step 2: Render the HTML report

```bash
node .claude/skills/eval/scripts/render-report.js .artifacts/$KEY/
```

This script:
- Reads all JSON/CSV artifacts from the directory
- Embeds screenshots as base64 into the HTML (reads from `screenshots/` directory, matches paths in journey-log steps)
- Applies the template from `templates/evaluation-report.html`
- Writes the output to `.artifacts/<KEY>/evaluation-report.html`

### Step 3: Log the run

```bash
node .claude/skills/eval/scripts/log-run.js .artifacts/$KEY/ --note="<note>"
```

If `--note` was not provided, use a default: `"Evaluation run"`. On iterations, use `"Iteration <N>"`.

### Step 4: Confirm output

Verify the HTML file was written:

```bash
test -f "$ARTIFACTS_DIR/evaluation-report.html" && echo "Report generated: $ARTIFACTS_DIR/evaluation-report.html"
```

Report the file path and size to the caller.
