---
name: prototype-iterate
description: Automated eval-refine loop — evaluates a prototype, refines based on failures, re-evaluates until done. Handles regression detection and iteration archiving.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__atlassian__getJiraIssue, mcp__atlassian__searchJiraIssuesUsingJql
---

# prototype-iterate

Orchestrates the eval → refine → re-eval feedback loop. Runs prototype-evaluate, reads the results, invokes prototype-refine on failures, then re-evaluates. Stops when done.

### How It Connects to the Pipeline

This skill wraps prototype-evaluate and prototype-refine in a loop. Each iteration runs the full eval pipeline (Phases 1-4), collects failures, feeds them to refine, and re-evaluates. Three sources feed refinement suggestions: FAIL criteria from AC evaluation, low usability dimension scores (0-1), and PatternFly consistency violations. Consistency fixes are applied first (deterministic file+line changes), then FAIL criteria, then usability gaps.

## Usage

```
/prototype-iterate RHAISTRAT-1527 http://localhost:9000 --workspace=~/Desktop/rhoai-prototypes
/prototype-iterate RHAISTRAT-1527 http://localhost:9000 --workspace=~/Desktop/rhoai-prototypes --max-iterations=5
/prototype-iterate RHAISTRAT-1527 http://localhost:9000 --workspace=~/Desktop/rhoai-prototypes --mode=auto
```

## Inputs

| Input | Example | Required | Default |
|-------|---------|----------|---------|
| Jira story key | `RHAISTRAT-1527` | Yes | — |
| Prototype URL | `http://localhost:9000` | Yes | — |
| `--workspace` | Path to prototype repo | Yes | — |
| `--max-iterations` | Number | No | 3 (standard) / 6 (auto) |
| `--depth` | `quick` or `thorough` | No | `thorough` |
| `--mode` | `standard` or `auto` | No | `standard` |
| `--no-reset` | flag | No | Off (workspace resets to MR baseline by default) |

## Modes

### Standard Mode (default)

Stops when no FAIL criteria remain. FLAGGED items are left for human review.

### Auto Mode (`--mode=auto`)

Attempts to resolve ALL items — including FLAGGED — without human intervention. Uses decision-kit recommendations and deeper evaluation strategies. Does not stop until ALL journeys pass and ALL criteria are PASS (or max iterations hit).

**Auto mode FLAGGED resolution strategy (2-phase):**

**Phase A — Gather more evidence (first 2 attempts per FLAGGED item):**
- Re-run the journey for the flagged criterion with `--depth=thorough` and extended timeouts
- Try alternative Playwright strategies (different click paths, scroll further, wait longer)
- Check if the feature exists in source code but is unreachable (flag as nav issue instead)
- If evidence confirms PASS → override verdict. If evidence confirms FAIL → treat as FAIL for Phase B.

**Phase B — Fix if still flagged (after 2 evidence attempts):**
- Read decision-kit recommendations from `.artifacts/<KEY>/decisions/decisions.json` if available
- Infer the intended behavior from the RFE acceptance criteria and Outcome context
- Generate a fix suggestion treating the FLAGGED item as a FAIL
- Apply the fix via prototype-refine
- Re-evaluate to confirm

**Auto mode exit conditions:**
1. **All PASS** — every criterion passes (no FAIL, no FLAGGED)
2. **All journeys pass** — every Playwright persona journey completes successfully
3. **Max iterations** — default 6 for auto mode (higher than standard because FLAGGED resolution takes extra cycles)
4. **Regression detected** — same as standard mode
5. **Unfixable FLAGGED** — if a criterion requires backend/runtime verification that is structurally impossible from the prototype (Tier 3 backend items), mark as `"unfixable": true` and exclude from the loop

## Exit Conditions — Standard Mode

1. **All PASS** — no FAIL criteria remaining (FLAGGED is acceptable, those need human eyes)
2. **Max iterations reached** — default 3, prevents infinite loops and runaway costs
3. **Regression detected** — a criterion that was PASS in iteration N becomes FAIL in iteration N+1. This means the refine made things worse. Stop immediately.
4. **Human override** — if `refinement-suggestions.json` contains only items where `human_verdict` was set (from the Review tab), the loop respects those and stops.

## Loop Logic

### Re-iteration Optimization

On iterations 2+, the loop passes `--skip-extract` to prototype-evaluate. This skips Phase 1 (Jira extraction, RFE/Outcome discovery, breadcrumb building) and reuses the cached `extract-state.json` from iteration 1. Phase 1 outputs are static — the Jira ticket content does not change between iterations. This eliminates 5-12 redundant Jira API calls per iteration.

The only Phase 1 data that changes between iterations is `mr-delta.json` (the git diff), which `--skip-extract` refreshes automatically when `--workspace` is provided.

### Timing Instrumentation

Each iteration records phase-level timing in `.artifacts/<KEY>/timing.json`. This data is appended per iteration and feeds into `iteration-log.json` and `run-log.csv` for cross-run performance comparison.

At the START of each phase, record the timestamp:
```bash
PHASE_START=$(date -u +%s%3N)
```

At the END of each phase, compute duration:
```bash
PHASE_END=$(date -u +%s%3N)
DURATION_MS=$((PHASE_END - PHASE_START))
```

Write to `.artifacts/<KEY>/timing.json` after each iteration:

```json
{
  "iterations": [
    {
      "iteration": 1,
      "timestamp": "2026-06-22T14:20:00Z",
      "phases": {
        "extract": { "duration_ms": 45200, "skipped": false, "jira_api_calls": 8 },
        "journey": { "duration_ms": 62300, "skipped": false, "journeys_run": 6, "journeys_skipped": 0, "playwright_setup_ms": 12000 },
        "usability": { "duration_ms": 18500, "skipped": false, "think_aloud": false, "personas_scored": 2 },
        "report": { "duration_ms": 3200 },
        "refine": { "duration_ms": 15800, "files_modified": 1 }
      },
      "total_duration_ms": 145000
    },
    {
      "iteration": 2,
      "timestamp": "2026-06-22T14:25:00Z",
      "phases": {
        "extract": { "duration_ms": 0, "skipped": true },
        "journey": { "duration_ms": 22100, "skipped": false, "journeys_run": 2, "journeys_skipped": 4 },
        "usability": { "duration_ms": 12000, "skipped": false, "think_aloud": false, "personas_scored": 2 },
        "report": { "duration_ms": 3100 },
        "refine": { "duration_ms": 8200, "files_modified": 1 }
      },
      "total_duration_ms": 45400
    }
  ],
  "aggregate": {
    "total_wall_clock_ms": 190400,
    "phase_1_skipped_iterations": 1,
    "total_jira_api_calls": 8,
    "total_playwright_runs": 8
  }
}
```

```
iteration = 0

# RESET TO MR BASELINE (unless --no-reset is passed)
# By default, the workspace resets to the MR state so iteration 1 captures the original prototype.
# Use --no-reset when a designer is evaluating their current local work (not an MR).
if NOT --no-reset:
  cd <workspace>
  git checkout -- .    # Discard any local changes from prior eval runs
  git checkout <branch>  # Ensure correct branch (detect from known_mrs in product-overlay.yaml)

LOOP:
  iteration += 1

  # Archive previous iteration's artifacts (if not first run)
  if iteration > 1:
    cp .artifacts/<KEY>/evaluation-report.csv → .artifacts/<KEY>/evaluation-report-iter-{iteration-1}.csv
    cp -r .artifacts/<KEY>/screenshots/ → .artifacts/<KEY>/screenshots-iter-{iteration-1}/

  # ALWAYS clear screenshots before each eval (prevents stale images)
  rm -rf .artifacts/<KEY>/screenshots/
  mkdir -p .artifacts/<KEY>/screenshots/

  # Timing: record phase start
  record_phase_start("evaluate")

  # Step 1: Evaluate
  if iteration == 1:
    # First iteration: run full evaluation including Phase 1 (Jira extraction)
    Run /prototype-evaluate <KEY> <URL> --depth=<depth> --feed-to-refine
  else:
    # Re-iterations: skip Phase 1 (Jira data is cached in extract-state.json)
    Run /prototype-evaluate <KEY> <URL> --depth=<depth> --feed-to-refine --skip-extract
  # Consistency checker MUST run on every iteration (especially after refine makes changes)
  # It's part of Phase 2 — ensure .context/consistency-checker/ is available

  # Timing: record phase end
  record_phase_end("evaluate")

  # Step 2: Check exit conditions
  Read .artifacts/<KEY>/evaluation-report.csv
  Count FAIL items (exclude FLAGGED — those are for humans)
  
  if FAIL count == 0:
    STOP → "All criteria pass. Loop complete."
  
  if iteration > 1:
    Compare current CSV verdicts against previous iteration
    if any criterion flipped PASS → FAIL:
      STOP → "Regression detected: <criterion-id> was PASS, now FAIL. Stopping to prevent further damage."

  if iteration >= max_iterations:
    STOP → "Max iterations reached. <N> FAIL items remain."

  # Timing: record refine start
  record_phase_start("refine")

  # Step 3: Refine
  Read .artifacts/<KEY>/refinement-suggestions.json
  
  Prioritize suggestions:
    1. Consistency violations (deterministic, file+line fixes)
    2. FAIL criteria (requires code changes)
    3. Usability gaps scoring 0-1 (design improvements)
  
  Run /prototype-refine <KEY> --suggestions=.artifacts/<KEY>/refinement-suggestions.json --workspace=<workspace>
  
  # Timing: record refine end
  record_phase_end("refine")

  # Write timing data
  Append iteration timing to .artifacts/<KEY>/timing.json

  # Step 4: Wait for rebuild
  Wait for the dev server to pick up changes (HMR):
    - Watch for webpack recompile if dev server running
    - Or: wait 5 seconds for static builds
  
  GOTO LOOP
```

## Output

After the loop completes, READ the final `iteration-log.json` and `evaluation-report.csv` to get the ACTUAL numbers. Do NOT compute pass/fail counts from memory — always read them back from the artifacts. The report is the source of truth.

Print a summary:

```
────────────────────────────────────────
Prototype Iteration: <KEY>
────────────────────────────────────────
Iterations: <N>
Exit reason: <all pass | max iterations | regression>

Iteration 1: <pass>/<total> PASS, <fail> FAIL, <flagged> FLAGGED
Iteration 2: <pass>/<total> PASS, <fail> FAIL, <flagged> FLAGGED
...

Delta: +<N> criteria fixed, -<M> regressions
Usability: <iter1 score>/21 → <final score>/21

Remaining FAIL: <list or "none">
Remaining FLAGGED: <list> (requires human review)
────────────────────────────────────────
Report: .artifacts/<KEY>/evaluation-report.html
```

## Artifacts per iteration

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/evaluation-report-iter-N.csv` | Archived CSV from iteration N |
| `.artifacts/<KEY>/screenshots-iter-N/` | Archived screenshots from iteration N |
| `.artifacts/<KEY>/refinement-suggestions.json` | Current iteration's suggestions (overwritten each loop) |
| `.artifacts/<KEY>/iteration-log.json` | Machine-readable log of all iterations |

## iteration-log.json format

```json
{
  "key": "RHAISTRAT-1527",
  "max_iterations": 3,
  "iterations": [
    {
      "iteration": 1,
      "pass_count": 4,
      "fail_count": 3,
      "flagged_count": 2,
      "usability_score": 14.5,
      "suggestions_generated": 5,
      "consistency_fixes": 2,
      "timing": {
        "extract_ms": 45200,
        "journey_ms": 62300,
        "usability_ms": 18500,
        "report_ms": 3200,
        "refine_ms": 15800,
        "total_ms": 145000
      }
    },
    {
      "iteration": 2,
      "pass_count": 6,
      "fail_count": 1,
      "flagged_count": 2,
      "usability_score": 16.0,
      "suggestions_generated": 2,
      "consistency_fixes": 0,
      "regressions": []
    }
  ],
  "exit_reason": "max_iterations",
  "total_criteria_fixed": 2,
  "total_regressions": 0
}
```

## Human Annotations

If the CSV from a previous run has `human_verdict` and `human_notes` columns (from the Review tab in the HTML report):
- Criteria where `human_verdict = PASS` are EXCLUDED from refinement suggestions (human said it's fine)
- Criteria where `human_verdict = FAIL` are INCLUDED even if automated verdict was FLAGGED
- Human notes are passed through to the refine skill as additional context

This prevents the loop from "fixing" things a human already verified as working.

## Error Handling

- **Prototype URL unreachable:** Wait 10s, retry once. If still down, stop with error.
- **Refine produces no changes:** Stop — if the refine skill can't figure out what to change, more iterations won't help.
- **Dev server crashes after refine:** Stop with error, note which file changes may have caused it.
