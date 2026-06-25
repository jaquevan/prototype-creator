---
name: eval-iterate
description: Orchestrate the full eval pipeline — chains extract, classify, journey, consistency, usability, and report phases. Runs eval-fix loop up to 3 cycles until all criteria pass.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__atlassian__getJiraIssue, mcp__atlassian__searchJiraIssuesUsingJql, mcp__atlassian__addCommentToJiraIssue
---

# eval-iterate

The orchestrator for the eval pipeline. Chains all eval phases in order, then runs a fix loop (max 3 cycles) until the goal condition is met.

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

## Pipeline Flow

```
eval-extract → eval-classify → eval-journey → eval-consistency → eval-usability → eval-report
                                                                                      ↓
                                                                              All PASS? → Done
                                                                              FAIL + cycle ≤ 3 → eval-fix → loop from eval-classify
                                                                              FAIL + cycle > 3 → Flag for human
```

## Goal Condition

**Zero FAIL verdicts in evaluation-report.csv Section 1.**

FLAGGED items are acceptable (they need human review). The loop only targets FAILs.

## Orchestration Logic

```
iteration = 0
max_iterations = parse --max-iterations (default: 3)
original_usability_flag = parse --usability (default: "deep")

LOOP:
  iteration += 1

  # ── Archive previous iteration ──────────────────────────────────
  if iteration > 1:
    cp .artifacts/<KEY>/evaluation-report.csv → .artifacts/<KEY>/evaluation-report-iter-{iteration-1}.csv
    cp -r .artifacts/<KEY>/screenshots/ → .artifacts/<KEY>/screenshots-iter-{iteration-1}/

  # ── Phase 1: Extract (iteration 1 only) ────────────────────────
  if iteration == 1:
    Read .claude/skills/eval/eval-extract/SKILL.md and execute it
    # Produces: extract-state.json, mr-delta.json, outcome-context.json
  else:
    # SKIP Phase 1 — reuse cached extract-state.json
    # Only refresh mr-delta.json if --workspace provided:
    if --workspace:
      cd <workspace> && git diff <base>...HEAD --name-only
      Update .artifacts/<KEY>/mr-delta.json with new changed files

  # ── Phase 1b: Navigation Hints (iteration 1 only, when --workspace) ─
  if iteration == 1 AND --workspace:
    Read .claude/skills/eval/eval-hint/SKILL.md and execute it
    # Produces: navigation-hints.json (selectors, routes, nav hierarchy)
    # Runs once — hints are static across iterations

  # ── Phase 2a: Classify ─────────────────────────────────────────
  if iteration == 1:
    Read .claude/skills/eval/eval-classify/SKILL.md and execute it
    # Produces: evaluation-report.csv (Section 1, tiers only)
  else:
    Read .claude/skills/eval/eval-classify/SKILL.md and execute it with:
      --rerun-only=<comma-separated FAIL+FLAGGED AC IDs from previous CSV>

  # ── Phase 2b: Journey walkthroughs ─────────────────────────────
  if iteration == 1:
    Read .claude/skills/eval/eval-journey/SKILL.md and execute it
    # eval-journey reads navigation-hints.json if it exists (from Phase 1b)
  else:
    Read .claude/skills/eval/eval-journey/SKILL.md and execute it with:
      --rerun-only=<FAIL+FLAGGED AC IDs>
    # Only runs Playwright for journeys testing failing criteria

  # ── Phase 2c: Consistency check ────────────────────────────────
  Read .claude/skills/eval/eval-consistency/SKILL.md and execute it
  # Skips automatically if .context/consistency-checker/ missing

  # ── Phase 3: Usability scoring ─────────────────────────────────
  Determine usability depth:
    if iteration >= max_iterations:
      usability_flag = original_usability_flag  # Final: honor user's choice
    else:
      usability_flag = "skip"  # Mid-loop: inference only, no think-aloud

  Read .claude/skills/eval/eval-usability/SKILL.md and execute it with:
    --usability=<usability_flag>
    --iteration=<iteration>

  # ── Phase 4: Report ────────────────────────────────────────────
  Read .claude/skills/eval/eval-report/SKILL.md and execute it with:
    --note="Iteration <iteration>"

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
      "pass_count": <computed from CSV>,
      "fail_count": <computed from CSV>,
      "flagged_count": <computed from CSV>,
      "usability_score": <read from journey-log.json usability_dimensions.overall_score>,
      "suggestions_generated": <count of entries in refinement-suggestions.json>,
      "consistency_fixes": <count of type:consistency in refinement-suggestions.json>
    }

  Also compute:
    total_criteria_fixed = current pass_count - iteration 1 pass_count
    (read iteration 1 from the iterations array, not estimated)

  # ── Exit condition checks ──────────────────────────────────────
  if fail_count == 0:
    Set exit_reason = "all_pass"
    STOP → "All criteria pass. Loop complete."

  if iteration > 1:
    Compare current CSV verdicts against previous iteration's archived CSV
    if any criterion flipped PASS → FAIL:
      Set exit_reason = "regression"
      STOP → "Regression detected: <criterion-id> was PASS, now FAIL."

  if iteration >= max_iterations:
    Set exit_reason = "max_iterations"
    STOP → "Max iterations reached. <N> FAIL items remain for human review."

  if --no-iterate:
    Set exit_reason = "no_iterate"
    STOP → "Single evaluation run complete. <N> FAIL items remain."

  # ── Phase 5: Fix ───────────────────────────────────────────────
  Read .claude/skills/eval/eval-fix/SKILL.md and execute it
  # Applies fixes from refinement-suggestions.json

  # Wait for dev server rebuild
  sleep 3

  GOTO LOOP
```

## Selective Rerun (Iterations 2+)

On re-iterations, only re-evaluate criteria that FAILED or were FLAGGED:

1. Parse previous `evaluation-report.csv` for FAIL/FLAGGED IDs
2. Pass `--rerun-only=AC-3,AC-5` to eval-classify and eval-journey
3. Those skills carry forward PASS verdicts and only re-run the failures
4. Screenshots from PASS journeys are preserved

This reduces Playwright execution proportionally to passing criteria count.

## Regression Detection

After each iteration (2+), compare verdicts against the previous CSV:
- If a criterion that was PASS becomes FAIL → **regression**
- Stop immediately, report which criterion regressed and which fix caused it
- The archived CSVs (`evaluation-report-iter-N.csv`) provide the comparison baseline

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/evaluation-report.html` | Final HTML report |
| `.artifacts/<KEY>/evaluation-report.csv` | Final verdicts |
| `.artifacts/<KEY>/iteration-log.json` | Per-iteration pass/fail/flagged counts |
| `.artifacts/<KEY>/evaluation-report-iter-N.csv` | Archived CSV per iteration |
| `.artifacts/<KEY>/screenshots-iter-N/` | Archived screenshots per iteration |

## iteration-log.json format

```json
{
  "key": "<KEY>",
  "max_iterations": 3,
  "iterations": [
    {
      "iteration": 1,
      "pass_count": 4,
      "fail_count": 3,
      "flagged_count": 2,
      "usability_score": 14.5,
      "suggestions_generated": 5,
      "consistency_fixes": 2
    }
  ],
  "exit_reason": "all_pass | max_iterations | regression | no_iterate",
  "total_criteria_fixed": 2,
  "total_regressions": 0
}
```

## Summary Output

After loop completes, print:

```
────────────────────────────────────────
Eval Pipeline: <KEY>
────────────────────────────────────────
Story:       <title>
URL:         <url>
Iterations:  <N>
Exit reason: <reason>

Iteration 1: <pass>/<total> PASS, <fail> FAIL, <flagged> FLAGGED
Iteration 2: ...

Criteria:  <total>
  PASS:    <n>
  FAIL:    <n>
  FLAGGED: <n> (needs human review)

Usability: <score>/21
Report:    .artifacts/<KEY>/evaluation-report.html
────────────────────────────────────────
```

## Error Handling

- **Prototype URL unreachable:** Wait 10s, retry once. If still down, stop with error.
- **eval-fix produces no changes:** Stop — more iterations won't help.
- **Dev server crashes after fix:** Stop, note which files may have caused it.
- **Missing .context/ directories:** Run eval without those phases (degrade gracefully).
