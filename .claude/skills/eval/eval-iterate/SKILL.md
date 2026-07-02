---
name: eval-iterate
description: "Orchestrate the two-phase eval pipeline: Phase A validates acceptance criteria with an informed evaluator (fix loop). Phase B runs blind per-persona Playwright walkthroughs for usability scoring."
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__atlassian__getJiraIssue, mcp__atlassian__searchJiraIssuesUsingJql, mcp__atlassian__addCommentToJiraIssue
---

# eval-iterate

Two-phase eval pipeline orchestrator. Phase A (x-ray) validates acceptance criteria with an informed evaluator that has full code access, fixing until all ACs pass. Phase B (blind) runs per-persona Playwright walkthroughs to score usability on a known-good prototype.

## Prerequisites

```bash
make context
```

Ensure `.context/usability-testing/`, `.context/consistency-checker/` are bootstrapped.

## Usage

```
/eval-iterate RHAISTRAT-1536 http://localhost:3000 --workspace=~/Desktop/rhoai-prototypes
/eval-iterate RHAISTRAT-1536 http://localhost:4200 --max-iterations=2
```

## Inputs

| Input | Example | Required | Default |
|-------|---------|----------|---------|
| Jira story key | `RHAISTRAT-1536` | Yes | — |
| Prototype URL | `http://localhost:3000` | Yes | — |
| `--workspace` | Path to prototype repo | No | — |
| `--max-iterations` | Number | No | 3 |
| `--depth` | `deep` | No | `deep` |
| `--usability` | `deep` or `skip` | No | `deep` |
| `--no-iterate` | flag | No | Off |
| `--no-fix` | flag | No | Off |
| `--reset` | flag | No | Off (evaluate current state; when set, hard-resets workspace to origin branch HEAD before eval) |

## Pipeline Flow (Two-Phase)

```
PHASE A (X-Ray — Informed AC Validation Loop):
  eval-extract → eval-consistency (once) → eval-classify → eval-journey (informed)
                                                              ↓
                                                      All PASS? → Phase B
                                                      FAIL + cycle ≤ max → eval-fix → loop from eval-classify
                                                      FAIL + cycle > max → Flag for human, then Phase B

PHASE B (Blind — Per-Persona Usability Walkthroughs):
  eval-usability (per-persona Playwright, think-aloud, 7-dimension scoring) → eval-report
```

## Goal Condition

**Phase A exits when:** zero FAIL verdicts in evaluation-report.csv Section 1, OR max iterations reached.

**Phase B fires:** always (unless `--usability=skip`). Runs once on the final prototype state.

FLAGGED items are acceptable (they need human review). The Phase A loop only targets FAILs.

## Orchestration Logic

```
iteration = 0
max_iterations = parse --max-iterations (default: 3)
usability_flag = parse --usability (default: "deep")
no_fix = parse --no-fix (default: false)

# Initialize persistent state (survives context compression)
python3 .claude/skills/eval/scripts/eval_state.py init .artifacts/<KEY>/eval-state.yaml \
  iteration=0 max_iterations=$max_iterations exit_reason=pending \
  phase=a ac_pass=false key=<KEY> url=<URL> workspace=<workspace>

# ═══════════════════════════════════════════════════════════════════
# PHASE A: X-Ray AC Validation Loop
# Question: "Did the code produce what the acceptance criteria specify?"
# Method: Informed evaluator with full source + hint access
# ═══════════════════════════════════════════════════════════════════

# ── Workspace state capture ───────────────────────────────────────
# The eval ALWAYS tests the current workspace state.
# Designers iterate: make changes → run eval → see results → fix → re-run.
# We never reset their work unless explicitly asked via --reset.

if workspace provided:
  cd <workspace>

  # Capture current state for the report (what exactly are we evaluating?)
  WORKSPACE_COMMIT=$(git log -1 --format="%h" 2>/dev/null || echo "unknown")
  WORKSPACE_MSG=$(git log -1 --format="%s" 2>/dev/null || echo "")
  WORKSPACE_DIRTY=$(git status --short 2>/dev/null | wc -l | tr -d ' ')

  # Optional: --reset flag for CI or reproducible testing (NOT default)
  if --reset:
    git fetch origin 2>/dev/null
    BRANCH=$(git branch --show-current)
    git reset --hard origin/$BRANCH
    echo "⚠ Workspace reset to origin/$BRANCH"
    # Re-capture state after reset
    WORKSPACE_COMMIT=$(git log -1 --format="%h")
    WORKSPACE_DIRTY=0

  # Log workspace state to eval-state.yaml for the report
  python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
    workspace_commit=$WORKSPACE_COMMIT workspace_dirty=$WORKSPACE_DIRTY

  # ── Detect server type (static vs dev/HMR) ──────────────────────
  # Static servers (sirv, serve, http-server) don't rebuild on source changes.
  # Dev servers (webpack serve, vite, next dev) auto-rebuild via HMR.
  # This determines whether we need explicit `npm run build` after eval-fix.
  SERVER_PID=$(lsof -ti:<PORT> 2>/dev/null | head -1)
  SERVER_CMD=$(ps -p $SERVER_PID -o command= 2>/dev/null || echo "")

  if SERVER_CMD contains "sirv" or "serve" or "http-server" or SERVER_CMD is empty:
    NEEDS_REBUILD=true
    echo "⚠ Static server detected (or server type unknown). Will rebuild after each fix iteration."
    echo "  For faster iteration: use 'npm run start:dev' (webpack dev server with HMR) instead."
  else:
    NEEDS_REBUILD=false
    echo "Dev server detected. HMR will handle rebuilds automatically."

# ── Setup (runs once) ──────────────────────────────────────────────

Read .claude/skills/eval/eval-extract/SKILL.md and execute it
# Produces: extract-state.json, mr-delta.json, outcome-context.json

Read .claude/skills/eval/eval-consistency/SKILL.md and execute it
# Runs ONCE. Produces: consistency-report.json, adds to refinement-suggestions.json
# PatternFly violations don't change between AC fix iterations.

# ── AC Fix Loop ────────────────────────────────────────────────────

LOOP:
  iteration += 1
  python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml iteration=$iteration

  # ── Classify ───────────────────────────────────────────────────
  if iteration == 1:
    Read .claude/skills/eval/eval-classify/SKILL.md and execute it
    # Produces: evaluation-report.csv (Section 1, tiers only)
  else:
    Read .claude/skills/eval/eval-classify/SKILL.md and execute it with:
      --rerun-only=<comma-separated FAIL+FLAGGED AC IDs from previous CSV>

  # ── Journey (informed mode) ────────────────────────────────────
  # The informed evaluator uses workspace source directly for navigation.
  # No blind-first pretense — goal is fast AC verification.
  if iteration == 1:
    Read .claude/skills/eval/eval-journey/SKILL.md and execute it with:
      --mode=informed
    # Uses workspace source for selectors/routes. Verifies ACs quickly.
  else:
    Read .claude/skills/eval/eval-journey/SKILL.md and execute it with:
      --mode=informed --rerun-only=<FAIL+FLAGGED AC IDs>
    # Only runs Playwright for journeys testing failing criteria

  # ── Archive this iteration ─────────────────────────────────────
  cp .artifacts/<KEY>/evaluation-report.csv → .artifacts/<KEY>/evaluation-report-iter-<iteration>.csv
  cp -r .artifacts/<KEY>/screenshots/ → .artifacts/<KEY>/screenshots-iter-<iteration>/

  # ── Compute counts FROM the CSV (source of truth) ──────────────
  Read .artifacts/<KEY>/evaluation-report.csv Section 1 (ACCEPTANCE CRITERIA)
  Parse using proper CSV quoting (fields may contain commas):
    pass_count = count rows where verdict column == "PASS"
    fail_count = count rows where verdict column == "FAIL"
    flagged_count = count rows where verdict column == "FLAGGED"

  NEVER manually estimate these counts. Always compute from the CSV file.

  # ── Write iteration entry to iteration-log.json ────────────────
  # Use the append-iteration-log.js script for rich, consistent entries:
  node .claude/skills/eval/scripts/append-iteration-log.js .artifacts/<KEY>/ <iteration> a

  # This script reads CSV, journey-log, fix-log, refinement-suggestions, and
  # consistency-report to produce a complete iteration entry including:
  #   - pass/fail/flagged counts (from CSV)
  #   - per-AC verdict details (from CSV)
  #   - journey coverage mapping (from journey-log)
  #   - changes_applied (from fix-log.json, if fix loop ran)
  #   - root_cause (if any FAILs)
  #   - consistency_summary (from consistency-report)
  #   - timestamp for timing analysis

  # Read the updated log to get computed counts for exit checks:
  Read .artifacts/<KEY>/iteration-log.json for pass_count, fail_count from the last entry

  # ── Exit condition checks ──────────────────────────────────────
  if fail_count == 0 AND flagged_count == 0:
    Set exit_reason = "all_pass"
    python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
      exit_reason=all_pass ac_pass=true
    BREAK → proceed to Phase B

  if fail_count == 0 AND flagged_count > 0:
    # FLAGGED items may be fixable (e.g., wrong interaction pattern, missing mock state)
    # Attempt fix loop on FLAGGED suggestions. If eval-fix produces no changes, exit.
    if iteration > 1:
      # Check if fix-log.json from last iteration had zero applied fixes for FLAGGED items
      Read .artifacts/<KEY>/fix-log.json
      if fix-log shows 0 applied fixes (all skipped/deferred):
        Set exit_reason = "flagged_unfixable"
        python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
          exit_reason=flagged_unfixable ac_pass=true
        BREAK → proceed to Phase B (FLAGGED items need human review)
    # Otherwise continue to fix loop — eval-fix will attempt FLAGGED suggestions

  if iteration > 1:
    Compare current CSV verdicts against previous iteration's archived CSV
    if any criterion flipped PASS → FAIL:
      Set exit_reason = "regression"
      python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
        exit_reason=regression ac_pass=false
      BREAK → proceed to Phase B (on current prototype state)

  if iteration >= max_iterations:
    Set exit_reason = "max_iterations"
    python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
      exit_reason=max_iterations ac_pass=false
    BREAK → proceed to Phase B (even with remaining FAILs)

  if --no-iterate:
    Set exit_reason = "no_iterate"
    python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
      exit_reason=no_iterate ac_pass=false
    BREAK → proceed to Phase B

  # ── Fix ────────────────────────────────────────────────────────
  if no_fix:
    Set exit_reason = "no_fix"
    python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
      exit_reason=no_fix ac_pass=false
    BREAK → proceed to Phase B
    # Findings remain in refinement-suggestions.json for human/agent review

  Read .claude/skills/eval/eval-fix/SKILL.md and execute it
  # Applies fixes from refinement-suggestions.json (AC failures + consistency + flagged)

  # Record what was fixed into the iteration log (reads fix-log.json)
  node .claude/skills/eval/scripts/append-iteration-log.js .artifacts/<KEY>/ <iteration> fix

  # ── Rebuild so changes are visible to Playwright ─────────────────
  if NEEDS_REBUILD:
    cd <workspace>
    npm run build
    # Wait for build to complete (webpack production ~15-30s)
    echo "Rebuilt dist after fixes — screenshots will reflect new code"
  else:
    # Dev server with HMR — changes visible after recompile
    sleep 5

  GOTO LOOP

# ═══════════════════════════════════════════════════════════════════
# FINAL-STATE CAPTURE (N+1 pass — only when fix loop actually ran)
# Ensures the report shows post-fix screenshots, not pre-fix evidence
# ═══════════════════════════════════════════════════════════════════

# Only run if the fix loop applied changes (iterations > 1)
if iteration > 1:
  # Archive the current screenshots as the last iteration's evidence
  # (they may be from a selective rerun, not a full re-capture)

  # Re-run eval-journey in screenshot-only mode: full journey set, no verdict changes
  # This captures final-state screenshots that reflect all applied fixes
  Read .claude/skills/eval/eval-journey/SKILL.md and execute in capture-only mode:
    --mode=informed --capture-only --all-journeys
  # This re-walks ALL journeys (not just the re-run set) and captures fresh screenshots
  # to .artifacts/<KEY>/screenshots/ — overwriting the partial captures from fix iterations.
  # Verdict CSV is NOT modified. journey-log.json step screenshots are updated in-place.

  # Ensure the rebuild completed before capturing (static server needs explicit build)
  if NEEDS_REBUILD:
    cd <workspace>
    npm run build
    echo "Final rebuild complete — N+1 screenshots will show post-fix state"
  else:
    sleep 5

# ═══════════════════════════════════════════════════════════════════
# PHASE B: Blind Persona Walkthroughs
# Question: "Can real users actually use this?"
# Method: Per-persona Playwright, blind navigation, think-aloud scoring
# ═══════════════════════════════════════════════════════════════════

# Skip Phase B entirely if --usability=skip
if usability_flag == "skip":
  python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml phase=b
  GOTO REPORT

python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml phase=b

# Phase B always runs at full depth — the prototype is known-good (or best-effort).
# No degraded/inference-only mode. Personas run their own Playwright walkthroughs.
#
# CRITICAL: Phase B REQUIRES separate Playwright browser sessions for each persona.
# The prototype URL must be navigated by each persona independently.
# Phase B is NOT inference-only scoring — it MUST produce new screenshots.
# Do NOT skip the Playwright walkthroughs and score from Phase A evidence alone.

Read .claude/skills/eval/eval-usability/SKILL.md and execute it
# Produces: per-persona screenshots, think-aloud traces, 7-dimension scores,
#           usability suggestions for human review

# VERIFY: Per-persona screenshots must exist after eval-usability completes.
# Check: ls .artifacts/<KEY>/screenshots/persona-*.png
# If no persona screenshots exist, Phase B did not run correctly.
# Go back and re-run eval-usability — ensure Step 1d actually launches Playwright.

# Update iteration log with usability results
node .claude/skills/eval/scripts/append-iteration-log.js .artifacts/<KEY>/ <iteration> b

# ═══════════════════════════════════════════════════════════════════
# REPORT (always runs)
# ═══════════════════════════════════════════════════════════════════

REPORT:
Read .claude/skills/eval/eval-report/SKILL.md and execute it with:
  --note="Phase A: <exit_reason> (<iteration> iterations). Phase B: <usability status>"

# ═══════════════════════════════════════════════════════════════════
# NOTIFY (open report + present summary)
# ═══════════════════════════════════════════════════════════════════

# Open the report for the designer
open .artifacts/<KEY>/evaluation-report.html

# Present narrative summary in chat (same model as eval-review)
Read .artifacts/<KEY>/evaluation-report.csv and .artifacts/<KEY>/extract-state.json
Compute pass/fail/flagged counts from CSV
Present:

  Eval complete for <KEY>: <story title>

  **What passed:** <pass>/<total> acceptance criteria. [Usability: <score>/21]
  **What needs attention:** <list failed/flagged items, 1 line each>
  **What to do:** <prioritized actions from refinement-suggestions.json>

  ---
  How can I help?
  • "Fix [issue]" — I'll apply the fix
  • "Tell me more about [finding]"
  • "Re-run eval"
  • "Looks good"

# Rebuild leaderboard with latest data
node .claude/skills/eval/scripts/build-leaderboard.js
```

## Selective Rerun (Phase A Iterations 2+)

On re-iterations, only re-evaluate criteria that FAILED or were FLAGGED:

1. Parse previous `evaluation-report.csv` for FAIL/FLAGGED IDs
2. Pass `--rerun-only=AC-3,AC-5` to eval-classify and eval-journey
3. Those skills carry forward PASS verdicts and only re-run the failures
4. Screenshots from PASS journeys are preserved

This reduces Playwright execution proportionally to passing criteria count.

## Regression Detection

After each Phase A iteration (2+), compare verdicts against the previous CSV:
- If a criterion that was PASS becomes FAIL → **regression**
- Stop immediately, report which criterion regressed and which fix caused it
- The archived CSVs (`evaluation-report-iter-N.csv`) provide the comparison baseline
- Phase B still runs after regression (captures usability of current state)

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/evaluation-report.html` | Final HTML report (both phases) |
| `.artifacts/<KEY>/evaluation-report.csv` | Final AC verdicts + usability dimensions |
| `.artifacts/<KEY>/iteration-log.json` | Per-iteration counts + Phase B usability |
| `.artifacts/<KEY>/evaluation-report-iter-N.csv` | Archived CSV per Phase A iteration |
| `.artifacts/<KEY>/screenshots-iter-N/` | Archived screenshots per Phase A iteration |
| `.artifacts/<KEY>/screenshots/persona-<id>-step-N.png` | Phase B per-persona screenshots |
| `.artifacts/<KEY>/usability-thinkaloud-<id>.md` | Phase B think-aloud traces |

## iteration-log.json format

```json
{
  "key": "<KEY>",
  "max_iterations": 3,
  "iterations": [
    {
      "iteration": 1,
      "phase": "a",
      "timestamp": "2026-07-01T15:00:00.000Z",
      "pass_count": 4,
      "fail_count": 3,
      "flagged_count": 2,
      "total_criteria": 9,
      "suggestions_generated": 5,
      "consistency_fixes": 2,
      "details": {
        "AC-1": { "verdict": "PASS", "tier": "T1" },
        "AC-2": { "verdict": "FAIL", "tier": "T1" },
        "AC-3": { "verdict": "FLAGGED", "tier": "T3" }
      },
      "journey_coverage": {
        "AC-1": { "journey_id": "journey-1", "journey_title": "...", "verdict": "PASS", "steps_completed": 3 }
      },
      "root_cause": "3 criteria failed: AC-2, AC-4, AC-5",
      "changes_applied": [
        { "criterion": "AC-2", "type": "ac_failure", "file": "src/Component.tsx", "change": "Added missing button" }
      ],
      "files_modified": ["src/Component.tsx"],
      "consistency_summary": { "violations": 0, "warnings": 3, "passes": 5 }
    }
  ],
  "phase_b": {
    "phase": "b",
    "timestamp": "2026-07-01T15:10:00.000Z",
    "usability_score": "15.5/21",
    "personas_evaluated": ["deena-junior", "deena-senior"],
    "dimension_scores": {
      "workflow_continuity": 2.5,
      "system_status": 3
    },
    "persona_summary": [
      { "persona": "deena-junior", "patience_end": 70, "confusion_events": 2, "abandoned": false }
    ]
  },
  "exit_reason": "all_pass",
  "total_criteria_fixed": 3,
  "total_regressions": 0,
  "files_modified": ["src/Component.tsx"]
}
```

## Summary Output

After pipeline completes, print:

```
────────────────────────────────────────
Eval Pipeline: <KEY>
────────────────────────────────────────
Story:       <title>
URL:         <url>

PHASE A — AC Validation:
  Iterations:  <N>
  Exit reason: <reason>
  Iteration 1: <pass>/<total> PASS, <fail> FAIL, <flagged> FLAGGED
  Iteration 2: ...
  Criteria:  <total>
    PASS:    <n>
    FAIL:    <n>
    FLAGGED: <n> (needs human review)

PHASE B — Usability:
  Personas:  <list>
  Score:     <score>/21
  Key finding: <one-liner from highest-impact dimension>

Report: .artifacts/<KEY>/evaluation-report.html
────────────────────────────────────────
```

## Error Handling

- **Prototype URL unreachable:** Wait 10s, retry once. If still down, stop with error.
- **eval-fix produces no changes:** Stop Phase A — more iterations won't help. Proceed to Phase B.
- **Dev server crashes after fix:** Stop Phase A, note which files may have caused it. Proceed to Phase B.
- **Missing .context/ directories:** Phase A runs without consistency. Phase B skipped if usability-testing missing.
