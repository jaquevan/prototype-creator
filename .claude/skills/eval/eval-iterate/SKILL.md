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
python3 scripts/eval_state.py init .artifacts/<KEY>/eval-state.yaml \
  iteration=0 max_iterations=$max_iterations exit_reason=pending \
  phase=a ac_pass=false key=<KEY> url=<URL> workspace=<workspace>

# ═══════════════════════════════════════════════════════════════════
# PHASE A: X-Ray AC Validation Loop
# Question: "Did the code produce what the acceptance criteria specify?"
# Method: Informed evaluator with full source + hint access
# ═══════════════════════════════════════════════════════════════════

# ── Setup (runs once) ──────────────────────────────────────────────

Read .claude/skills/eval/eval-extract/SKILL.md and execute it
# Produces: extract-state.json, mr-delta.json, outcome-context.json

Read .claude/skills/eval/eval-consistency/SKILL.md and execute it
# Runs ONCE. Produces: consistency-report.json, adds to refinement-suggestions.json
# PatternFly violations don't change between AC fix iterations.

# ── AC Fix Loop ────────────────────────────────────────────────────

LOOP:
  iteration += 1
  python3 scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml iteration=$iteration

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
  Append to .artifacts/<KEY>/iteration-log.json:
    {
      "iteration": <iteration>,
      "phase": "a",
      "pass_count": <computed from CSV>,
      "fail_count": <computed from CSV>,
      "flagged_count": <computed from CSV>,
      "suggestions_generated": <count of entries in refinement-suggestions.json>,
      "consistency_fixes": <count of type:consistency in refinement-suggestions.json>
    }

  Also compute:
    total_criteria_fixed = current pass_count - iteration 1 pass_count
    (read iteration 1 from the iterations array, not estimated)

  # ── Exit condition checks ──────────────────────────────────────
  if fail_count == 0:
    Set exit_reason = "all_pass"
    python3 scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
      exit_reason=all_pass ac_pass=true
    BREAK → proceed to Phase B

  if iteration > 1:
    Compare current CSV verdicts against previous iteration's archived CSV
    if any criterion flipped PASS → FAIL:
      Set exit_reason = "regression"
      python3 scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
        exit_reason=regression ac_pass=false
      BREAK → proceed to Phase B (on current prototype state)

  if iteration >= max_iterations:
    Set exit_reason = "max_iterations"
    python3 scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
      exit_reason=max_iterations ac_pass=false
    BREAK → proceed to Phase B (even with remaining FAILs)

  if --no-iterate:
    Set exit_reason = "no_iterate"
    python3 scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
      exit_reason=no_iterate ac_pass=false
    BREAK → proceed to Phase B

  # ── Fix ────────────────────────────────────────────────────────
  if no_fix:
    Set exit_reason = "no_fix"
    python3 scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
      exit_reason=no_fix ac_pass=false
    BREAK → proceed to Phase B
    # Findings remain in refinement-suggestions.json for human/agent review

  Read .claude/skills/eval/eval-fix/SKILL.md and execute it
  # Applies fixes from refinement-suggestions.json (AC failures + consistency)

  # Wait for dev server rebuild
  sleep 3

  GOTO LOOP

# ═══════════════════════════════════════════════════════════════════
# PHASE B: Blind Persona Walkthroughs
# Question: "Can real users actually use this?"
# Method: Per-persona Playwright, blind navigation, think-aloud scoring
# ═══════════════════════════════════════════════════════════════════

# Skip Phase B entirely if --usability=skip
if usability_flag == "skip":
  python3 scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml phase=b
  GOTO REPORT

python3 scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml phase=b

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
Append to .artifacts/<KEY>/iteration-log.json:
  {
    "phase": "b",
    "usability_score": <read from journey-log.json usability_dimensions.overall_score>,
    "personas_evaluated": <read from journey-log.json usability_dimensions.personas_evaluated>
  }

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
      "pass_count": 4,
      "fail_count": 3,
      "flagged_count": 2,
      "suggestions_generated": 5,
      "consistency_fixes": 2
    },
    {
      "iteration": 2,
      "phase": "a",
      "pass_count": 7,
      "fail_count": 0,
      "flagged_count": 2,
      "suggestions_generated": 0,
      "consistency_fixes": 0
    }
  ],
  "phase_b": {
    "usability_score": "15.5/21",
    "personas_evaluated": ["deena-junior", "deena-senior"]
  },
  "exit_reason": "all_pass",
  "total_criteria_fixed": 3,
  "total_regressions": 0
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
