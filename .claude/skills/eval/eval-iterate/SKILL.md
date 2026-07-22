---
name: eval-iterate
description: "Orchestrate the two-phase eval pipeline: Phase A validates acceptance criteria with an x-ray evaluator (fix loop). Phase B runs discovery-based per-persona Playwright walkthroughs for usability scoring."
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__atlassian__getJiraIssue, mcp__atlassian__searchJiraIssuesUsingJql, mcp__atlassian__addCommentToJiraIssue
---

# eval-iterate

Two-phase eval pipeline orchestrator. Phase A (x-ray) validates acceptance criteria with an x-ray evaluator that has full code access, fixing until all ACs pass. Phase B (discovery) runs per-persona Playwright walkthroughs to score usability on a known-good prototype.

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

### Evaluating an Existing Prototype (no RFE required)

You can evaluate any running prototype by pointing the pipeline at its URL and workspace. No RFE or Jira ticket is strictly required — you can use the STRAT key directly or even a synthetic key for ad-hoc evaluations:

```
/eval-iterate RHAISTRAT-432 http://localhost:8080 --workspace=~/Desktop/rhoai-prototypes
```

If the Jira ticket has no ACs, the pipeline will stop and ask for them. You can also point to a folder without a Jira ticket by providing ACs manually via a local `rfe-snapshot.md` placed in `.artifacts/<KEY>/`.

## Inputs

| Input | Example | Required | Default |
|-------|---------|----------|---------|
| Jira story key | `RHAISTRAT-1536` | Yes | — |
| Prototype URL | `http://localhost:3000` | Yes | — |
| `--workspace` | Path to prototype repo | No | — |
| `--max-iterations` | Number | No | 3 |
| `--depth` | `deep` | No | `deep` |
| `--usability` | `deep` | No | `deep` |
| `--no-iterate` | flag | No | Off |
| `--no-fix` | flag | No | Off |
| `--reset` | flag | No | Off (evaluate current state; when set, hard-resets workspace to origin branch HEAD before eval) |
| `--fresh` | flag | No | Off (when set, deletes .artifacts/<KEY>/ before starting for a clean-slate run) |
| `--auto-run` | flag | No | Off (when set, chains shell commands to reduce approval prompts in Claude Code from ~20 to ~5) |
| `--no-report` | flag | No | Off (when set, skips HTML report generation and prints a compact chat summary instead. Use `/generate-report` later to create the full report from cached artifacts) |

## Environment Detection

Before parsing flags, check the execution environment:

```
if $CURSOR_AGENT is set:
  # Running in Cursor — tool approvals are handled automatically
  # No action needed
else:
  # Likely Claude Code (VS Code) — Bash commands require individual approval
  echo "Detected non-Cursor environment (Claude Code / VS Code)."
  echo "The pipeline runs ~20 shell commands that each require approval."
  echo "Tip: Use --auto-run to reduce approval prompts to ~5 at natural checkpoints."
  echo "Or add these patterns to ~/.claude/settings.json:"
  echo '  "Bash(node .claude/skills/eval/scripts/*)"'
  echo '  "Bash(node .artifacts/*)"'
  echo '  "Bash(npm run build)"'
  echo '  "Bash(git log *)", "Bash(git status *)"'
```

When `--auto-run` is set, chain related commands with `&&` into 5 groups at natural pipeline boundaries:

| Group | Commands chained | Checkpoint purpose |
|-------|-----------------|-------------------|
| 1. Workspace state | `git log -1 --format="%h" && git status --short` | See what commit is being evaluated |
| 2. Phase A validation | `node validate-verdicts.js && cp archive && node append-iteration-log.js` | See iteration results |
| 3. Fix + rebuild | `cd workspace && npm run build` | See fixes being compiled |
| 4. Playwright | `node .artifacts/<KEY>/journey-test.mjs` or `node .artifacts/<KEY>/persona-walkthrough.mjs` | See browser automation start |
| 5. Report | `node validate-artifacts.js && node render-report.js && node log-run.js` | See final report generated |

## Pipeline Flow (Two-Phase)

```
PHASE A (X-Ray — Informed AC Validation Loop):
  eval-extract (--phase=core) → eval-consistency (--mode=source) → eval-classify → eval-verify (informed)
                                                                                     ↓
                                                                             Exit condition met? → Phase B (ALWAYS)
                                                                             FAIL + cycle ≤ max → eval-fix → loop from eval-classify

  Exit conditions (any triggers Phase B):
    all_pass          — 0 FAIL, 0 FLAGGED (clean pass)
    flagged_unfixable — 0 FAIL, FLAGGED items unfixable (pass with caveats)
    max_iterations    — still has FAILs after N loops (best-effort)
    regression        — fix loop broke a previously-passing AC (degraded)
    no_fix/no_iterate — user flag or single-run mode

POST-PHASE-A (deferred context gathering — ALL THREE RUN IN PARALLEL):
  eval-consistency (--mode=visual) — screenshots now exist
  eval-extract (--phase=enrichment) — Outcome, tasks_to_be_done, breadcrumb
  eval-nav-context — navigation hints for discovery personas (reflects post-fix workspace state)

PHASE B (Discovery — Per-Persona Usability Walkthroughs) — FIRES IF .context/usability-testing/ EXISTS:
  eval-discover (per-persona Playwright, think-aloud, 7-dimension scoring) → eval-report
  Note: Phase B runs on whatever prototype state exists after Phase A exits.
  When exit_reason != all_pass, usability scores may reflect missing features.
```

## Goal Condition

**Phase A exits when:** zero FAIL verdicts in evaluation-report.csv Section 1, OR max iterations reached.

**Phase B fires:** always. Runs once on the final prototype state.

FLAGGED items are acceptable (they need human review). The Phase A loop only targets FAILs.

## Orchestration Logic

```
iteration = 0
max_iterations = parse --max-iterations (default: 3)
no_fix = parse --no-fix (default: false)

# ── Fresh flag handling ────────────────────────────────────────────
# --fresh deletes all prior artifacts for this KEY before starting.
if --fresh:
  rm -rf .artifacts/<KEY>/
  echo "Cleared .artifacts/<KEY>/ (--fresh)"

# ── Staleness detection (content-based) ────────────────────────────
# eval-extract Step 0 handles cache validation using a content hash of the
# ticket description. The orchestrator no longer compares timestamps, which
# avoids false invalidation when eval-iterate itself adds comments to the ticket.
# If --fresh is set, artifacts are already cleared above. Otherwise, let
# eval-extract's own cache check (content hash) decide whether to re-fetch.

# Initialize persistent state (survives context compression)
python3 .claude/skills/eval/scripts/eval_state.py init .artifacts/<KEY>/eval-state.yaml \
  iteration=0 max_iterations=$max_iterations exit_reason=pending \
  phase=a ac_pass=false key=<KEY> url=<URL> workspace=<workspace> \
  pipeline_start=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

# ═══════════════════════════════════════════════════════════════════
# PHASE A: X-Ray AC Validation Loop
# Question: "Did the code produce what the acceptance criteria specify?"
# Method: X-ray evaluator with full source + hint access
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

# ── Setup (runs once, consolidated) ────────────────────────────────
# All setup steps (eval-state init, workspace capture, server detection,
# node_modules symlink, Playwright check) are consolidated in one script.
# This replaces ~40 individual tool calls with a single invocation.

bash .claude/skills/eval/scripts/pipeline-setup.sh <KEY> <URL> <workspace> $max_iterations [--reset if set]

# The script outputs NEEDS_REBUILD=true|false which determines whether
# we run `npm run build` after eval-fix applies changes.

# ── Per-skill timing ──────────────────────────────────────────────
# Record start/end timestamps for each skill to measure optimization impact.

python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
  extract_core_start=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

Read .claude/skills/eval/eval-extract/SKILL.md and execute it with --phase=core
# Produces: extract-state.json, mr-delta.json
# Defers: outcome-context.json, tasks_to_be_done, breadcrumb (run before Phase B)

python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
  extract_core_end=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp) \
  consistency_source_start=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

Read .claude/skills/eval/eval-consistency/SKILL.md and execute it with --mode=source
# Runs ONCE (source-mode only). Produces: consistency-report.json, appends to refinement-suggestions.json
# Visual-mode deferred to after eval-verify when screenshots exist.
# Uses analyze.py bash commands for deterministic checks (no report generation).

python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
  consistency_source_end=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

# ── AC Fix Loop ────────────────────────────────────────────────────

LOOP:
  iteration += 1
  python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml iteration=$iteration

  # ── Classify ───────────────────────────────────────────────────
  if iteration == 1:
    python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
      classify_start=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

    Read .claude/skills/eval/eval-classify/SKILL.md and execute it
    # Produces: evaluation-report.csv (Section 1, tiers only)

    python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
      classify_end=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)
  # Iteration 2+: skip classify entirely. Tiers are structural and don't change.
  # The CSV already has tier assignments from iteration 1. Only verdicts need updating.

  # ── Journey (x-ray mode) ────────────────────────────────────
  # The x-ray evaluator uses workspace source directly for navigation.
  # No discovery-first pretense — goal is fast AC verification.
  #
  # ── Playwright script caching ──────────────────────────────
  # The most expensive part of verify is generating journey-test.mjs
  # (~3-5 min of LLM output). If a prior run produced one for the same
  # workspace commit and AC set, reuse it instead of regenerating.
  # The actual Playwright execution is fast (~30s for 7 journeys).
  # Playwright script caching is handled by generate-journey-script.js:
  # It writes a // CACHE_HASH: header based on MD5(component-map + extract-state).
  # On subsequent runs, if the hash matches, it skips regeneration entirely.
  # No manual cache check needed here — eval-verify's Step 3a calls the generator,
  # which self-caches. --force-regenerate bypasses the cache if needed.

  python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
    verify_start=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

  if iteration == 1:
    Read .claude/skills/eval/eval-verify/SKILL.md and execute it with:
      --mode=informed
    # Uses workspace source for selectors/routes. Verifies ACs quickly.
  else:
    # Iteration 2+: skip SKILL.md re-read (~5K tokens saved). The eval-verify
    # procedure is already in context from iteration 1. Only re-run Steps 3-8
    # with --rerun-only targeting FAIL+FLAGGED ACs from the previous CSV.
    Execute eval-verify procedure with:
      --mode=informed --rerun-only=<FAIL+FLAGGED AC IDs from previous CSV>
    # Only runs Playwright for journeys testing failing criteria
    # Carries forward PASS verdicts from previous iteration

  python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
    verify_end=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

  # ── Verdict cross-check (BLOCKING — bidirectional) ──────────────
  node .claude/skills/eval/scripts/validate-verdicts.js .artifacts/<KEY>/
  # Checks BOTH directions:
  #   - Journey FAIL + CSV PASS → violation (CSV must be FAIL/FLAGGED)
  #   - Journey PASS + CSV FAIL → violation (CSV must be updated to PASS)
  # If exit code 1: FIX the CSV to match journey-log verdicts before continuing.
  # The CSV is the source of truth for the report — if it has wrong verdicts,
  # the report will show wrong results even if the pipeline thinks everything passed.

  # ── Archive this iteration ─────────────────────────────────────
  cp .artifacts/<KEY>/evaluation-report.csv → .artifacts/<KEY>/evaluation-report-iter-<iteration>.csv
  cp -r .artifacts/<KEY>/screenshots/ → .artifacts/<KEY>/screenshots-iter-<iteration>/

  # ── Compute counts FROM the CSV (source of truth) ──────────────
  # CRITICAL: Read the CSV FILE, not journey-log.json, not agent memory.
  # The CSV is what the report renders. If you use different counts,
  # the pipeline will report "7/7 PASS" while the report shows "0/7".
  Read .artifacts/<KEY>/evaluation-report.csv Section 1 (ACCEPTANCE CRITERIA)
  Parse using proper CSV quoting (fields may contain commas):
    pass_count = count rows where verdict column == "PASS"
    fail_count = count rows where verdict column == "FAIL"
    flagged_count = count rows where verdict column == "FLAGGED"

  NEVER use journey-log verdicts for these counts. NEVER manually estimate.
  Always compute from the CSV file — it is the ONLY source of truth.

  # ── Write iteration entry to iteration-log.json ────────────────
  # ALWAYS use the script — NEVER write iteration-log.json directly.
  # The script reads the CSV (source of truth) for pass/fail/flagged counts.
  node .claude/skills/eval/scripts/append-iteration-log.js .artifacts/<KEY>/ <iteration> a

  # This script reads CSV, journey-log, fix-log, refinement-suggestions, and
  # consistency-report to produce a complete iteration entry including:
  #   - pass/fail/flagged counts (from CSV — NOT from journey-log)
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
    # Skip refinement-suggestions.json — no one will act on suggestions
    # when --no-fix is set. The verify verdicts and screenshots are
    # sufficient for the report. This saves LLM output tokens that
    # would otherwise go to generating fix suggestions no one reads.

  python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
    fix_start=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

  if iteration == 1:
    Read .claude/skills/eval/eval-fix/SKILL.md and execute it
  else:
    # Iteration 2+: skip SKILL.md re-read. Procedure already in context.
    Execute eval-fix procedure
  # Applies fixes from refinement-suggestions.json (AC failures + consistency + flagged)

  python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
    fix_end=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

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

  # Re-run eval-verify in screenshot-only mode: full journey set, no verdict changes
  # This captures final-state screenshots that reflect all applied fixes
  Read .claude/skills/eval/eval-verify/SKILL.md and execute in capture-only mode:
    --mode=informed --capture-only --all-journeys
  # This re-walks ALL journeys (not just the re-run set) and captures fresh screenshots
  # to .artifacts/<KEY>/screenshots/ — overwriting the partial captures from fix iterations.
  # Verdict CSV is NOT modified. journey-log.json step screenshots are updated in-place.
  # IMPORTANT: --capture-only triggers Step 2b to re-scan source and refresh
  # component-map.json, so Phase B's generate-journey-script.js reads post-fix
  # columns, interaction patterns, and routes — not stale pre-fix data.

  # Ensure the rebuild completed before capturing (static server needs explicit build)
  if NEEDS_REBUILD:
    cd <workspace>
    npm run build
    echo "Final rebuild complete — N+1 screenshots will show post-fix state"
  else:
    sleep 5

# ═══════════════════════════════════════════════════════════════════
# PRE-PHASE-B: Deferred Context (PARALLEL)
# Three independent skills run in parallel — none depends on
# another's output. All three feed Phase B or the report.
# ═══════════════════════════════════════════════════════════════════

python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
  bridge_start=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

# Launch all three in parallel using Task tool with run_in_background=true:
#
# TASK 1: eval-consistency --mode=visual
#   Uses journey screenshots for visual guideline checks.
#   Appends visual findings to consistency-report.json.
#   Informational for report — does NOT re-trigger fix loop.
#   ERROR HANDLING: If fails, consistency-report.json keeps visual_mode.ran=false. Non-blocking.
#
# TASK 2: eval-extract --phase=enrichment
#   Produces: outcome-context.json, tasks_to_be_done, breadcrumb.
#   Uses cached raw_parent and raw_issuelinks from extract-state.json (saved during core phase).
#   ERROR HANDLING: If Outcome not found, falls back to deriving tasks from journey titles.
#   If entire enrichment fails, Phase B runs with tasks derived from journey titles.
#
# TASK 3: eval-nav-context (if workspace provided)
#   Produces: navigation-hints.json (nav_sections + routes only).
#   Consumed by eval-discover as fallback for stuck-persona navigation.
#   Runs post-fix so hints reflect final workspace state.
#   ERROR HANDLING: If fails, eval-discover runs without hints (discovery only, no fallback).

# Wait for all three to complete before proceeding to Phase B.

python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
  bridge_end=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

# ═══════════════════════════════════════════════════════════════════
# PHASE B: Discovery Persona Walkthroughs
# Question: "Can real users actually use this?"
# Method: Per-persona Playwright, discovery navigation, think-aloud scoring
# ═══════════════════════════════════════════════════════════════════

python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml phase=b

# Phase B always runs at full depth — the prototype is known-good (or best-effort).
# No degraded/inference-only mode. Personas run their own Playwright walkthroughs.
# If .context/usability-testing/ does not exist, skip Phase B and proceed directly to eval-report.
#
# CRITICAL: Phase B REQUIRES separate Playwright browser sessions for each persona.
# The prototype URL must be navigated by each persona independently.
# Phase B is NOT inference-only scoring — it MUST produce new screenshots.
# Do NOT skip the Playwright walkthroughs and score from Phase A evidence alone.

python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
  discover_start=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

# When --no-report is set, pass --screenshots=key-only to eval-discover.
# This captures 1 screenshot per persona-task (final state) instead of per-step,
# reducing from ~30 to 6 screenshots and skipping think-aloud markdown files.
# The persona trace data in persona-results.json is still written for scoring.
if --no-report:
  Read .claude/skills/eval/eval-discover/SKILL.md and execute it with --screenshots=key-only
else:
  Read .claude/skills/eval/eval-discover/SKILL.md and execute it
# Use Task tool with run_in_background=true for each persona-task pair when possible.
# Produces: per-persona screenshots, think-aloud traces (unless key-only), 7-dimension scores,
#           usability suggestions for human review

# VERIFY: Per-persona screenshots must exist after eval-discover completes.
# Check: ls .artifacts/<KEY>/screenshots/persona-*.png
# If no persona screenshots exist, Phase B did not run correctly.
# Go back and re-run eval-discover — ensure Step 1d actually launches Playwright.

# VALIDATE: Verify persona-results.json has non-empty trace[] arrays.
# If any persona-task entry has empty trace[], the walkthrough failed to write live data.
# In that case, re-run eval-discover for the affected persona (do NOT hydrate post-hoc).
# Trace data must be written during Step 1d — there is no post-hoc hydration script.
Read .artifacts/<KEY>/persona-results.json
if any entry has trace == [] (empty array):
  echo "WARNING: persona-results.json has empty trace[] — re-running eval-discover"
  Read .claude/skills/eval/eval-discover/SKILL.md and execute it

# ── Verify Step 8 completion (usability_dimensions in journey-log) ──
# persona-results.json existing WITHOUT usability_dimensions in journey-log
# means Step 8 was skipped. This breaks 3 downstream consumers:
# 1. render-report.js produces a report with no usability section
# 2. The "Usability Dimensions Scored" MLflow scorer fails
# 3. The leaderboard shows "N/A" instead of a usability score
#
# Do NOT skip this even if persona walkthroughs completed successfully —
# the walkthroughs produce per-persona data, but Step 8 consolidates it
# into the 7-dimension composite format the report and scorers expect.
Read .artifacts/<KEY>/journey-log.json
if "usability_dimensions" not in journey-log.json AND .artifacts/<KEY>/persona-results.json exists:
  echo "Step 8 missing — consolidating persona results into journey-log.json"
  Read .claude/skills/eval/eval-discover/SKILL.md Step 8 and execute ONLY Step 8
  # Re-read to verify
  Read .artifacts/<KEY>/journey-log.json
  if "usability_dimensions" still not present:
    echo "ERROR: Step 8 still not written after retry"

python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
  discover_end=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

# Update iteration log with usability results
node .claude/skills/eval/scripts/append-iteration-log.js .artifacts/<KEY>/ <iteration> b

# ── Propagate exit_reason to iteration-log.json ────────────────────
# The iteration-log.json root-level exit_reason is the canonical field
# that downstream consumers read (MLflow scorers, leaderboard, report).
# eval-state.yaml has it, but iteration-log.json needs it too —
# without it, the "Iteration Log Valid" scorer fails and the report
# shows "exit_reason: pending" even after the pipeline exits cleanly.
python3 -c "
import json
from pathlib import Path
ad = Path('.artifacts/<KEY>/')
# Read exit_reason from eval-state.yaml (source of truth)
exit_reason = 'unknown'
es = ad / 'eval-state.yaml'
if es.exists():
    for line in es.read_text().splitlines():
        if line.strip().startswith('exit_reason:'):
            exit_reason = line.split(':', 1)[1].strip()
# Write to iteration-log.json root level
il = ad / 'iteration-log.json'
if il.exists():
    log = json.loads(il.read_text())
    log['exit_reason'] = exit_reason
    log['key'] = '<KEY>'
    il.write_text(json.dumps(log, indent=2))
    print(f'iteration-log.json exit_reason set to: {exit_reason}')
"

# ═══════════════════════════════════════════════════════════════════
# REPORT (runs unless --no-report is set)
# ═══════════════════════════════════════════════════════════════════

REPORT:
if --no-report:
  # Skip heavy report generation — print brief chat summary, then offer mini-report.

  python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
    pipeline_end=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

  Read .artifacts/<KEY>/evaluation-report.csv and .artifacts/<KEY>/extract-state.json
  Compute pass/fail/flagged counts from CSV

  # ── Brief chat summary (always shown) ─────────────────────────────
  # Keep this short — 4 lines max. Designers scan, they don't read paragraphs.
  Present:

    Eval complete for <KEY>: <story title>
    **Result:** <pass>/<total> PASS, <fail> FAIL, <flagged> FLAGGED. Usability: <score>/21.
    **Key findings:** <top 2-3 issues, 1 line each>

  # ── Ask about mini-report ─────────────────────────────────────────
  # The mini-report is a lightweight HTML page with persona screenshots
  # and a direct link to the prototype. Only generate if the user wants it.
  Ask the user:
    "Would you like a mini-report with persona screenshots and a link to the prototype?"

  If user says yes:
    node .claude/skills/eval/scripts/render-mini-report.js .artifacts/<KEY>/
    open .artifacts/<KEY>/mini-report.html

  # ── Offer next steps ──────────────────────────────────────────────
  Present:
    How can I help?
    • "Fix [issue]" — I'll apply the fix
    • "Tell me more about [finding]"
    • "Re-run eval"
    • "/generate-report" — create the full HTML report
    • "Looks good"

else:
  Read .claude/skills/eval/eval-report/SKILL.md and execute it with:
    --note="Phase A: <exit_reason> (<iteration> iterations). Phase B: <usability status>"

  # ═══════════════════════════════════════════════════════════════════
  # NOTIFY (open report + present summary)
  # ═══════════════════════════════════════════════════════════════════

  python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
    pipeline_end=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

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
2. Pass `--rerun-only=AC-3,AC-5` to eval-verify
3. eval-verify carries forward PASS verdicts and only re-runs the failures
4. Screenshots from PASS journeys are preserved
5. eval-classify is NOT re-run (tiers are structural and don't change between iterations)

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

## Future: Phase B Feedback Loop (NOT YET IMPLEMENTED)

Phase B currently produces usability findings that go into the report but do not trigger fixes. This section documents the planned architecture for a feedback loop.

### Design

After Phase B completes, check whether usability findings are severe enough to warrant another Phase A iteration:

```
Phase B complete → Score check:
  - overall_score >= 14/21 AND no dimension = 0 → REPORT (no feedback)
  - overall_score < 14/21 OR any dimension = 0 → Feed usability suggestions to eval-fix → one more Phase A crank → REPORT
```

### Trigger Conditions

The feedback loop fires when ANY of:
- `overall_score` < 14/21 (below "functional" threshold)
- Any single dimension scores 0 (broken)
- 3+ confusion events across ALL personas combined

### What Gets Fed Back

Only `refinement-suggestions.json` entries of `type: "usability"` with `confidence: "high"` or `"medium"`. Low-confidence usability suggestions remain report-only (human judgment required).

### Constraints

- Max 1 feedback loop (prevents infinite cycling between Phase A and Phase B)
- The feedback Phase A crank does NOT re-run Phase B afterward (would create recursion)
- `--no-outer-loop` flag skips this entirely (for when designers just want the report)
- Feedback fixes are logged separately in fix-log.json as `"source": "phase_b_feedback"`

### What This Enables

Phase B persona walkthroughs currently identify issues like "junior user couldn't find the scheduling column because it requires scrolling right." With the feedback loop, this finding would generate a suggestion like "Add horizontal scroll indicator or move scheduling status column left" that eval-fix can apply, then Phase A re-verifies the fix works.
