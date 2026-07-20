---
name: eval-iterate
description: "Orchestrate the two-phase eval pipeline: Phase A validates acceptance criteria with an x-ray evaluator (fix loop). Phase B runs discovery-based per-persona Playwright walkthroughs for usability scoring."
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__atlassian__getJiraIssue, mcp__atlassian__searchJiraIssuesUsingJql, mcp__atlassian__addCommentToJiraIssue
---

<!-- Model: Opus for orchestration judgment. Mechanical steps (git, timing, file copies, npm build) could use cheaper model or scripts. -->

# eval-iterate

Two-phase eval pipeline orchestrator. Phase A (x-ray) validates acceptance criteria with an x-ray evaluator that has full code access, fixing until all ACs pass. Phase B (discovery) runs per-persona Playwright walkthroughs to score usability on a known-good prototype.

## Prerequisites

```bash
make context
```

**REQUIRED:** `.context/usability-testing/` and `.context/consistency-checker/` MUST be bootstrapped before running. The pipeline will not proceed without them. If missing, run `make context` first.

```bash
# Verify both exist before starting
test -d .context/consistency-checker/guidelines || { echo "FATAL: consistency-checker not bootstrapped. Run: make context"; exit 1; }
test -d .context/usability-testing/personas || { echo "FATAL: usability-testing not bootstrapped. Run: make context"; exit 1; }
```

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
| 4. Playwright | `node journey-test.mjs` or `node persona-walkthrough.mjs` | See browser automation start |
| 5. Report | `node validate-artifacts.js && node render-report.js && node log-run.js` | See final report generated |

> **Note:** `build-leaderboard.js` should be called from `log-run.js` as a post-hook, not directly by the orchestrator.

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

# ── eval-state.yaml: LLM Scratchpad ────────────────────────────────
# eval-state.yaml is the pipeline's persistent memory across context
# compression boundaries. When the LLM's context window fills up and
# earlier conversation is compressed, eval-state.yaml survives because
# it's a file on disk — not in-memory state.
#
# The LLM writes to it at every phase transition and reads it back
# after context compression to recover: current iteration, phase,
# exit reason, timing, workspace commit, and any other state needed
# to resume the pipeline without re-running completed steps.
#
# Fields:
#   iteration        — current loop counter
#   max_iterations   — cap from --max-iterations flag
#   exit_reason      — pending | all_pass | flagged_unfixable | max_iterations | regression | no_fix | no_iterate
#   phase            — a | b
#   ac_pass          — true | false
#   key              — Jira story key (e.g., RHAISTRAT-1536)
#   url              — prototype URL being tested
#   workspace        — path to prototype repo
#   workspace_commit — git commit hash being evaluated
#   workspace_dirty  — number of uncommitted changes
#   pipeline_start   — ISO timestamp when pipeline began
#   pipeline_end     — ISO timestamp when pipeline finished
#   extract_core_start/end — timing for eval-extract core phase
#   consistency_source_start/end — timing for eval-consistency source mode
#   bridge_start/end — timing for pre-Phase-B deferred context gathering
#
# Any skill can read/write additional fields using:
#   python3 .claude/skills/eval/scripts/eval_state.py set <path> key=value
#   python3 .claude/skills/eval/scripts/eval_state.py get <path> key

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

# ── Setup (runs once) ──────────────────────────────────────────────

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
    Read .claude/skills/eval/eval-classify/SKILL.md and execute it
    # Produces: evaluation-report.csv (Section 1, tiers only)
  # Iteration 2+: skip classify entirely. Tiers are structural and don't change.
  # The CSV already has tier assignments from iteration 1. Only verdicts need updating.

  # ── Journey (x-ray mode) ────────────────────────────────────
  # The x-ray evaluator uses workspace source directly for navigation.
  # No discovery-first pretense — goal is fast AC verification.
  if iteration == 1:
    Read .claude/skills/eval/eval-verify/SKILL.md and execute it with:
      --mode=informed
    # Uses workspace source for selectors/routes. Verifies ACs quickly.
  else:
    Read .claude/skills/eval/eval-verify/SKILL.md and execute it with:
      --mode=informed --rerun-only=<FAIL+FLAGGED AC IDs from previous CSV>
    # Only runs Playwright for journeys testing failing criteria
    # Carries forward PASS verdicts from previous iteration

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

  # ── Write iteration entry to iteration-log.json ────────────────
  # ALWAYS use the script — NEVER write iteration-log.json directly.
  # The script reads the CSV (source of truth) for pass/fail/flagged counts.
  node .claude/skills/eval/scripts/append-iteration-log.js .artifacts/<KEY>/ <iteration> a

  # ── Exit condition check (deterministic) ──────────────────────
  EXIT_REASON=$(node .claude/skills/eval/scripts/check-exit-condition.js .artifacts/<KEY>/ $iteration $max_iterations)
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 1 ]; then
    python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
      exit_reason=$EXIT_REASON ac_pass=$([ "$EXIT_REASON" = "all_pass" ] || [ "$EXIT_REASON" = "flagged_unfixable" ] && echo true || echo false)

    # ── Write exit_reason to iteration-log.json (MANDATORY) ────────
    # iteration-log.json must reflect the final exit reason, not stay "pending".
    node -e "const f='.artifacts/<KEY>/iteration-log.json'; const d=JSON.parse(require('fs').readFileSync(f,'utf8')); d.exit_reason='$EXIT_REASON'; require('fs').writeFileSync(f, JSON.stringify(d,null,2));"

    BREAK → proceed to Phase B
  fi

  # For selective rerun, get failing AC IDs:
  RERUN_ACS=$(node .claude/skills/eval/scripts/list-failing-acs.js .artifacts/<KEY>/evaluation-report.csv)

  # ── Fix ────────────────────────────────────────────────────────

  Read .claude/skills/eval/eval-fix/SKILL.md and execute it
  # Applies fixes from refinement-suggestions.json (AC failures + consistency + flagged)

  # Validate fix-log.json before using it
  node .claude/skills/eval/scripts/validate-fix-log.js .artifacts/<KEY>/
  # If exit code 1: fix-log.json is malformed. Log warning and proceed without fix data.

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
# SPEC FILE (core phase) — step-by-step UI requirements for Yoni's
# post-engineering workflow validator. Assembled from artifacts that
# already exist (journey-log.json + evaluation-report.csv) — no new
# evaluation logic. See eval-generate-spec/SKILL.md.
# ═══════════════════════════════════════════════════════════════════

node .claude/skills/eval/eval-generate-spec/scripts/generate-spec.js .artifacts/<KEY>/ --phase=core
# Produces: spec.md (AC section only — persona section added after Phase B below)
# Non-blocking: if this fails, log a warning and continue to Phase B. spec.md
# is a downstream connectivity artifact, not a pipeline gate.

# ═══════════════════════════════════════════════════════════════════
# FINAL-STATE CAPTURE (N+1 pass — only when fix loop actually ran)
# Ensures the report shows post-fix screenshots, not pre-fix evidence
# ═══════════════════════════════════════════════════════════════════

# Only run if the fix loop applied changes (iterations > 1)
if iteration > 1:
  # Archive the current screenshots as the last iteration's evidence
  # (they may be from a selective rerun, not a full re-capture)

  # Rebuild FIRST so screenshots reflect post-fix state
  if NEEDS_REBUILD:
    cd <workspace>
    npm run build
    echo "Final rebuild complete — N+1 screenshots will show post-fix state"
  else:
    sleep 5

  # THEN capture screenshots
  Read .claude/skills/eval/eval-verify/SKILL.md and execute in capture-only mode:
    --mode=informed --capture-only --all-journeys
  # This re-walks ALL journeys (not just the re-run set) and captures fresh screenshots
  # to .artifacts/<KEY>/screenshots/ — overwriting the partial captures from fix iterations.
  # Verdict CSV is NOT modified. journey-log.json step screenshots are updated in-place.

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

Read .claude/skills/eval/eval-discover/SKILL.md and execute it
# Use Task tool with run_in_background=true for each persona-task pair when possible.
# Produces: per-persona screenshots, think-aloud traces, 7-dimension scores,
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
  # This should not happen if Step 1d synchronous writing is followed correctly

# Update iteration log with usability results
node .claude/skills/eval/scripts/append-iteration-log.js .artifacts/<KEY>/ <iteration> b

# ═══════════════════════════════════════════════════════════════════
# SPEC FILE (enrichment phase) — adds persona-validated task flows
# from persona-results.json on top of the core-phase AC section.
# Idempotent: regenerates spec.md in full, does not append.
# ═══════════════════════════════════════════════════════════════════

node .claude/skills/eval/eval-generate-spec/scripts/generate-spec.js .artifacts/<KEY>/ --phase=enrichment
# Produces: spec.md (AC section + Persona-Validated Task Flows section)
# Non-blocking: if this fails, log a warning and continue to REPORT.

# ═══════════════════════════════════════════════════════════════════
# REPORT (runs unless --no-report is set)
# ═══════════════════════════════════════════════════════════════════

REPORT:
if --no-report:
  # Skip heavy report generation — print compact chat summary instead.
  # All artifacts are cached; the user can run /generate-report later.

  python3 .claude/skills/eval/scripts/eval_state.py set .artifacts/<KEY>/eval-state.yaml \
    pipeline_end=$(python3 .claude/skills/eval/scripts/eval_state.py timestamp)

  # Build the evaluation-summary.json (standalone, no render-report.js dependency)
  node .claude/skills/eval/scripts/build-summary.js .artifacts/<KEY>/

  # Read the summary for structured data
  Read .artifacts/<KEY>/evaluation-summary.json

  # Show unique screenshots inline — deduplicate by MD5 hash
  # Run: md5 -r .artifacts/<KEY>/screenshots/*.png | sort | uniq -w 32
  # Group by hash, pick one representative per unique hash.
  # Prefer screenshots with interactions (tooltip, expand) over the default table view.
  # Embed 3-4 unique screenshots inline in the chat message.

  Present:

    Eval complete for <KEY>: <story title> (no-report mode)

    **What passed:** <pass>/<total> acceptance criteria. [Usability: <score>/21]
    **What needs attention:** <list failed/flagged items, 1 line each>
    **Key screenshots:** <embed 3-4 unique screenshots inline showing distinct visual states>
    **What to do:** <prioritized actions from refinement-suggestions.json>
    **Spec file:** <verified>/<total> ACs ready for Yoni's workflow validator → `spec.md`

    ---
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
    **Spec file:** <verified>/<total> ACs ready for Yoni's workflow validator → `spec.md`

    ---
    How can I help?
    • "Fix [issue]" — I'll apply the fix
    • "Tell me more about [finding]"
    • "Re-run eval"
    • "Looks good"

  # NOTE: build-leaderboard.js should be called from log-run.js as a post-hook,
  # not directly by the orchestrator. Kept here until log-run.js owns that hook.
  node .claude/skills/eval/scripts/build-leaderboard.js
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
| `.artifacts/<KEY>/spec.md` | Step-by-step UI requirements for Yoni's post-engineering workflow validator (see `eval-generate-spec/SKILL.md`) |

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

Spec file: <verified>/<total> ACs Playwright-verified → .artifacts/<KEY>/spec.md
Report: .artifacts/<KEY>/evaluation-report.html
────────────────────────────────────────
```

## Error Handling

- **Prototype URL unreachable:** Wait 10s, retry once. If still down, stop with error.
- **eval-fix produces no changes:** Stop Phase A — more iterations won't help. Proceed to Phase B.
- **Dev server crashes after fix:** Stop Phase A, note which files may have caused it. Proceed to Phase B.
- **Missing .context/ directories:** STOP. Both `.context/consistency-checker/` and `.context/usability-testing/` are required. Instruct the user to run `make context` before retrying. The pipeline must not proceed without consistency checking.

