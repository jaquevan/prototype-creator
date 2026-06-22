---
name: prototype-iterate
description: Automated eval-refine loop — evaluates a prototype, refines based on failures, re-evaluates until done. Handles regression detection and iteration archiving.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__atlassian__getJiraIssue, mcp__atlassian__searchJiraIssuesUsingJql
---

# prototype-iterate

Orchestrates the eval → refine → re-eval feedback loop. Runs prototype-evaluate, reads the results, invokes prototype-refine on failures, then re-evaluates. Stops when done.

### How It Connects to the Pipeline

This skill wraps prototype-evaluate and prototype-refine in a loop. Iteration 1 runs the full eval pipeline (Phases 1-4). Re-iterations execute Phases 2-4 inline (skipping Phase 1 and reading sub-skill instructions directly) to keep the prompt cache warm and avoid redundant Jira extraction. Three sources feed refinement suggestions: FAIL criteria from AC evaluation, low usability dimension scores (0-1), and PatternFly consistency violations. Consistency fixes are applied first (deterministic file+line changes), then FAIL criteria, then usability gaps.

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

### Optimization Strategy

The iterate loop owns all performance optimization decisions. Sub-skills receive targeted flags — the loop decides WHEN and WHAT to optimize based on iteration state.

**Iteration 1** runs the full pipeline: Phase 1 (Jira extraction) → Phase 2 (journeys) → Phase 3 (usability) → Phase 4 (report) → refine.

**Iterations 2+** optimize aggressively:
- **Phase 1: SKIP entirely.** Read cached `extract-state.json` from iteration 1. Only refresh `mr-delta.json` (run `git diff` in the workspace). The Jira data, ACs, journey definitions, breadcrumb, and persona selection are static.
- **Phase 2: SELECTIVE.** Parse the previous iteration's `evaluation-report.csv` to build a `--rerun-only` list of FAIL and FLAGGED criteria IDs. Only re-run Playwright journeys that test those criteria. PASS criteria carry forward.
- **Phase 3: LIGHTWEIGHT.** Force inference-only usability scoring (no think-aloud) on non-final iterations. Only run think-aloud on the last iteration.
- **Phase 2+3: INLINE.** Instead of invoking `/prototype-evaluate` (which spawns a new context and reloads all skill files), directly read and execute `.claude/skills/evaluate-journey/SKILL.md` and `.claude/skills/evaluate-usability/SKILL.md` within the current session. This eliminates ~5% cache misses from cold skill file loads.
- **Screenshots: PRESERVE.** On re-iterations, only clear screenshots for re-run journeys. Carry forward screenshots from PASS journeys (they haven't changed). The final report includes all screenshots regardless of which iteration captured them.

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

# Parse user's original usability flag for final-iteration use
original_usability_flag = parse --usability from $ARGUMENTS (default: "inference")

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

  record_phase_start("evaluate")

  if iteration == 1:
    # ── FIRST ITERATION: full pipeline ──────────────────────────
    # Clear all screenshots for fresh capture
    rm -rf .artifacts/<KEY>/screenshots/
    mkdir -p .artifacts/<KEY>/screenshots/

    Run /prototype-evaluate <KEY> <URL> --depth=<depth> --feed-to-refine --usability=<original_usability_flag>

  else:
    # ── RE-ITERATIONS: optimized inline execution ───────────────

    # 1. Phase 1: SKIP — reuse cached extract-state.json
    #    Only refresh the git diff to capture refine's changes
    Read .artifacts/<KEY>/extract-state.json (cached from iteration 1)
    if --workspace:
      Refresh .artifacts/<KEY>/mr-delta.json:
        cd <workspace> && git diff <base>...HEAD --name-only
      Track which files refine modified (from previous iteration's refinement-suggestions.json)

    # 2. Build the --rerun-only list from previous CSV
    Read .artifacts/<KEY>/evaluation-report.csv
    Parse FAIL and FLAGGED criteria IDs:
      rerun_ids = [row.criterion_id for row in csv if row.verdict in ("FAIL", "FLAGGED")]
    If rerun_ids is empty: all criteria pass — exit loop early

    # 3. Selective screenshot clearing
    #    Only clear screenshots for journeys being re-run
    Read .artifacts/<KEY>/extract-state.json → journey_definitions
    For each journey:
      if ANY of journey.ac_ids are in rerun_ids:
        Delete screenshots/journey-{N}-step-*.png (will be recaptured)
      else:
        Keep existing screenshots (PASS journeys are unchanged)

    # 4. Phase 2: SELECTIVE journey walkthroughs (inline)
    Read .claude/skills/evaluate-journey/SKILL.md and execute it with:
      --rerun-only=<comma-separated rerun_ids>
      --depth=<depth>
    This carries forward PASS verdicts and only re-runs Playwright for FAIL/FLAGGED criteria.

    # 5. Phase 3: LIGHTWEIGHT usability scoring (inline)
    Determine usability depth for this iteration:
      if iteration >= max_iterations:
        usability_flag = original_usability_flag  # Final iteration: honor user's choice
      else:
        usability_flag = "inference"  # Mid-loop: skip think-aloud, inference only
    
    Read .claude/skills/evaluate-usability/SKILL.md and execute it with:
      --usability=<usability_flag>
      --iteration=<iteration>
    On re-iterations, only read screenshots from re-run journeys for usability scoring.
    Carry forward dimension scores for PASS journeys from the previous iteration.

    # 6. Phase 4: Report generation
    node scripts/render-report.js .artifacts/<KEY>/
    node scripts/log-run.js .artifacts/<KEY>/ --note="Iteration <iteration>"

  record_phase_end("evaluate")

  # ── Exit condition checks ─────────────────────────────────────
  Read .artifacts/<KEY>/evaluation-report.csv
  Count FAIL items (exclude FLAGGED — those are for humans)

  if FAIL count == 0:
    STOP → "All criteria pass. Loop complete."

  if iteration > 1:
    Compare current CSV verdicts against previous iteration
    if any criterion flipped PASS → FAIL:
      STOP → "Regression detected: <criterion-id> was PASS, now FAIL."

  if iteration >= max_iterations:
    STOP → "Max iterations reached. <N> FAIL items remain."

  # ── Refine ────────────────────────────────────────────────────
  record_phase_start("refine")

  Read .artifacts/<KEY>/refinement-suggestions.json

  Prioritize suggestions:
    1. Consistency violations (deterministic, file+line fixes)
    2. FAIL criteria (requires code changes)
    3. Usability gaps scoring 0-1 (design improvements)

  Run /prototype-refine <KEY> --suggestions=.artifacts/<KEY>/refinement-suggestions.json --workspace=<workspace>

  record_phase_end("refine")

  # Write timing data for this iteration
  Append iteration timing to .artifacts/<KEY>/timing.json

  # Wait for rebuild (HMR or static)
  Wait for dev server to pick up changes:
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
