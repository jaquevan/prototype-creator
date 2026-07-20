---
name: eval-generate-report
description: Generate the full HTML evaluation report from cached artifacts. Use after --no-report runs or to regenerate a report.
user-invocable: true
allowed-tools: Read, Bash, Glob
---

# eval-generate-report

Generate (or regenerate) the full HTML evaluation report from cached pipeline artifacts. Use this after a `--no-report` eval run, or any time you want to refresh the report from existing data.

## Usage

```
/generate-report RHAISTRAT-432
/eval-generate-report RHAISTRAT-1536
```

## Inputs

| Input | Example | Required |
|-------|---------|----------|
| Jira story key | `RHAISTRAT-432` | Yes |

## Procedure

**This skill is a thin wrapper around a shell script.** For direct invocation:
```bash
bash .claude/skills/eval/scripts/generate-report.sh .artifacts/<KEY>/ --open --leaderboard
```

### Step 1: Verify artifacts exist

```bash
KEY="<jira-key>"
test -f ".artifacts/$KEY/evaluation-report.csv" || { echo "ERROR: No eval artifacts found for $KEY. Run /eval-iterate first."; exit 1; }
test -f ".artifacts/$KEY/journey-log.json" || { echo "ERROR: journey-log.json missing for $KEY."; exit 1; }
test -f ".artifacts/$KEY/extract-state.json" || { echo "ERROR: extract-state.json missing for $KEY."; exit 1; }
```

### Step 2: Validate schemas

```bash
node .claude/skills/eval/scripts/validate-artifacts.js .artifacts/$KEY/
```

Fix any violations before proceeding.

### Step 3: Render the report

```bash
node .claude/skills/eval/scripts/render-report.js .artifacts/$KEY/
```

### Step 4: Log the run and rebuild leaderboard

```bash
node .claude/skills/eval/scripts/log-run.js .artifacts/$KEY/ --note="Report generated on demand"
# NOTE: build-leaderboard.js should be called from log-run.js as a post-hook,
# not directly by this skill. Kept here until log-run.js owns that hook.
node .claude/skills/eval/scripts/build-leaderboard.js
```

### Step 5: Open and confirm

```bash
open .artifacts/$KEY/evaluation-report.html
```

Report the file path and size to the user.
