# Prototype Eval Pipeline

Evaluates prototypes against Jira acceptance criteria and runs persona-based usability testing. Produces an HTML report with a narrative summary, expandable findings, and full evidence (screenshots, think-aloud traces, dimension scores).

## Target Outcome

The report is a **confidence gate + iteration driver** for designers:

- **If the prototype passes:** The designer knows it's ready and can approve it. One clear verdict, no guesswork.
- **If issues exist:** The designer knows exactly what needs fixing, why, and what to do next. Actionable, not informational.
- **If items need human judgment:** The designer sees what the AI couldn't verify and can make their own call with evidence.

The report answers three questions in under 10 seconds: *Did it pass? What needs my attention? What do I do next?*

## First Time Setup

If this is your first time using the eval, you need three things:

```bash
# 1. Make sure your prototype branch has the latest eval skills
# (if /eval-iterate doesn't appear as a slash command, you need to rebase)
cd ~/Desktop/rhoai-prototypes
git fetch upstream
git rebase upstream/3.6

# 2. Bootstrap context (required for usability scoring and consistency checks)
cd ~/Desktop/prototype-creator
make context

# 3. Start your prototype locally
cd ~/Desktop/rhoai-prototypes && npm run build && npm start
```

**Looking for /prototype-create?** That creates a NEW prototype from a Jira ticket. To evaluate an EXISTING prototype, use `/eval-iterate` instead.

**Slash command not appearing?** Restart your IDE to re-index skills. If it still doesn't appear, use the natural-language fallback: "Read `.claude/skills/eval/eval-iterate/SKILL.md` and run it against RHAISTRAT-1536 at http://localhost:3000 with workspace ~/Desktop/rhoai-prototypes"

## Quick Start

```bash
# Run the eval against your running prototype
/eval-iterate RHAISTRAT-1536 http://localhost:3000 --workspace=~/Desktop/rhoai-prototypes
```

The pipeline runs, opens the report when done, and presents a summary with suggested actions.

### Invocation Methods

Both methods are fully supported — use whichever works in your environment:

| Method | When to use |
|--------|-------------|
| **Slash command:** `/eval-iterate RHAISTRAT-1536 ...` | Default. Works when the IDE has indexed `.claude/skills/`. |
| **Natural language:** "Read `.claude/skills/eval/eval-iterate/SKILL.md` and run it against RHAISTRAT-1536 at http://localhost:3000 with workspace ~/Desktop/rhoai-prototypes" | Fallback when the slash command doesn't appear, or in VS Code / Claude Code where skill indexing may not trigger automatically. |

### Troubleshooting

**Slash command not appearing?**
- Restart your IDE (Cursor or VS Code) to re-index the skills directory
- If it still doesn't appear, use the natural-language method above — same pipeline, same results
- In Claude Code (terminal), skills are always invoked via natural language

### Claude Code Users (VS Code)

The eval pipeline runs ~20 shell commands (`node`, `npm`, `git`) that each require individual approval in Claude Code. Use `--auto-run` to reduce this to 5 checkpoints:

```
/eval-iterate RHAISTRAT-1536 http://localhost:3000 --workspace=~/Desktop/rhoai-prototypes --auto-run
```

Or permanently allow the pipeline's commands by adding these patterns to your `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(node .claude/skills/eval/scripts/*)",
      "Bash(node .artifacts/*)",
      "Bash(npm run build)",
      "Bash(git log *)",
      "Bash(git status *)"
    ]
  }
}
```

### Evaluating Existing Prototypes

You don't need an RFE to run an eval. If a team member already has a prototype running, point the pipeline at the STRAT key and the running server:

```bash
/eval-iterate RHAISTRAT-432 http://localhost:8080 --workspace=~/Desktop/rhoai-prototypes
```

The pipeline pulls ACs from the Jira ticket and evaluates the prototype as-is. For prototypes without a Jira ticket, place an `rfe-snapshot.md` with ACs in `.artifacts/<KEY>/` and the pipeline will use those instead of fetching from Jira.

### No-Report Mode

For fast iteration without the full HTML report (~14MB, ~2 min to render):

```bash
/eval-iterate RHAISTRAT-1536 http://localhost:3000 --workspace=~/Desktop/rhoai-prototypes --no-report
```

This prints a compact summary in chat with pass/fail counts, key screenshots, and refinement suggestions. Run `/generate-report` later when you want the full HTML report.

## What It Does

The pipeline has three stages:

**Phase A — AC Validation (X-Ray)**
An x-ray evaluator with full source access verifies each acceptance criterion from the Jira ticket using Playwright. Before generating scripts, it writes a `component-map.json` that maps AC concepts to actual DOM elements (column headers, tooltips, expandable rows, feature flags). Each AC gets a unique screenshot showing a different visual state (hover, expand, scroll — not just the default table view). If criteria fail, it applies fixes and re-runs (up to N iterations) until all pass.

**Post-A Bridge (Parallel)**
Three deferred skills run simultaneously: visual consistency checks (using journey screenshots), context enrichment (Outcome ticket, breadcrumb, persona tasks), and navigation context extraction (routes + nav hierarchy for persona fallback).

**Phase B — Usability Testing (Discovery)**
Per-persona Playwright walkthroughs where simulated users navigate the prototype at their own competence level. Produces think-aloud traces and scores 7 usability dimensions. Before/after comparison only shows when eval-fix actually changed the prototype.

```
Phase A: eval-extract (core) → eval-consistency (source) → eval-classify → eval-verify (x-ray)
                                                                             ↓
                                                                     All PASS? → Post-A
                                                                     FAIL? → eval-fix → loop

Post-A:  eval-consistency (visual) + eval-extract (enrichment) + eval-nav-context  [ALL PARALLEL]

Phase B: eval-discover (per-persona Playwright) → eval-report → open + summarize
```

## Key Design Decisions

- **CSV is the single source of truth** for verdicts. The report reads the CSV, not the journey-log. Both files must have identical verdicts — enforced by `validate-verdicts.js` (bidirectional check).
- **T1 is the default tier.** Any AC with an observable UI effect is T1, even if the AC text mentions backend concepts. T5 (hardware) was removed. Only T4 (subjective) produces FLAGGEDs.
- **Component map drives script generation.** eval-verify reads workspace source files and writes `component-map.json` before generating Playwright scripts. The script uses actual column indices and selectors from the map, never guessing from AC text.
- **Visual differentiation required.** Each journey screenshot must show a unique visual state (hover, expand, scroll). Multiple journeys screenshotting the same default table view is invalid.
- **PF6 script template.** eval-verify provides tested Playwright utilities (`navigateTo`, `expandRow`, `hoverElement`, `getTooltipText`, `checkNoErrors`) so the agent fills in AC-specific logic without writing boilerplate from scratch.
- **1920x900 viewport.** All Playwright contexts use this size. The default 800x600 truncates PatternFly tables.

## Tier System

ACs are classified into tiers that determine how to evaluate them:

| Tier | What it means | Verdict |
|------|---------------|---------|
| **T1** | Verifiable from prototype UI (default) | PASS or FAIL |
| **T2** | Needs external reference to compare (not yet implemented) | PASS, FAIL, or FLAGGED |
| **T3** | Backend-only, no UI surface | Auto-PASS at classify time |
| **T4** | Subjective — needs human judgment | FLAGGED with evidence |

T1 is the default. Any AC with an observable UI effect is T1, even if the AC text mentions backend concepts. T5 (hardware/headed browser) has been removed — those cases auto-PASS with a note.

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--workspace=PATH` | — | Path to the prototype repo (enables code fixes) |
| `--max-iterations=N` | 3 | Max fix loop iterations in Phase A |
| `--usability=deep` | deep | Run Phase B persona walkthroughs |
| `--no-iterate` | Off | Run Phase A once, no fix loop |
| `--no-fix` | Off | Pure evaluation — skip fixes, produce findings only |
| `--depth=deep` | deep | Evaluation thoroughness (vestigial — no branching logic; always runs at full depth) |

## Output Artifacts

All output goes to `.artifacts/<KEY>/` (gitignored):

| File | Producer | Description |
|------|----------|-------------|
| `extract-state.json` | eval-extract | ACs, journeys, personas, feature context, cached ticket data |
| `mr-delta.json` | eval-extract | Git diff analysis (changed files, categories) |
| `component-map.json` | eval-verify | AC-to-DOM element mapping (columns, tooltips, flags, selectors) |
| `consistency-report.json` | eval-consistency | PatternFly source + visual guideline findings |
| `evaluation-report.csv` | eval-classify → eval-verify | AC verdicts (source of truth), usability dimensions |
| `journey-log.json` | eval-verify → eval-discover | Playwright steps, verdicts, usability dimensions |
| `refinement-suggestions.json` | eval-verify + eval-consistency | Suggested fixes for failed criteria |
| `fix-log.json` | eval-fix | Record of fixes applied (when fix loop ran) |
| `outcome-context.json` | eval-extract (enrichment) | Parent Outcome ticket context |
| `navigation-hints.json` | eval-nav-context | Routes + nav hierarchy for persona fallback |
| `persona-results.json` | eval-discover | Structured trace data for persona walkthroughs |
| `iteration-log.json` | eval-iterate | Per-iteration pass/fail counts (from CSV) |
| `eval-state.yaml` | eval-iterate | Pipeline state, per-skill timing |
| `evaluation-report.html` | eval-report | Self-contained HTML report with embedded screenshots |
| `evaluation-summary.json` | eval-report | Agent-readable summary: AC verdicts, usability scores, counts, iteration state |
| `usability-thinkaloud-*.md` | eval-discover | Per-persona per-task think-aloud traces |
| `screenshots/` | eval-verify + eval-discover | Journey finals, persona walkthroughs, baselines |

## Designer Workflow

1. **Eval runs** (triggered manually or by automation)
2. **Report opens** automatically with narrative summary at the top
3. **Agent presents findings** in chat: what passed, what needs attention, what to do
4. **Designer chooses**: fix issues, ask questions, re-run, or approve

To review results from a previous run:
```
/eval-review RHAISTRAT-1536
```

## Skills Inventory

| Skill | Role |
|-------|------|
| `eval-iterate` | Orchestrator — runs the full pipeline |
| `eval-extract` | Pulls Jira context, ACs, personas, MR delta |
| `eval-classify` | Classifies ACs into evaluation tiers |
| `eval-nav-context` | Extracts navigation context (routes, nav hierarchy) from workspace source |
| `eval-verify` | Runs Playwright walkthroughs (x-ray mode for Phase A) |
| `eval-fix` | Applies fixes from refinement-suggestions.json |
| `eval-discover` | Phase B persona walkthroughs + 7-dimension scoring |
| `eval-consistency` | PatternFly design guideline compliance check |
| `eval-report` | Renders the HTML report from artifacts |
| `eval-generate-report` | On-demand HTML report from cached artifacts (after `--no-report`) |
| `eval-review` | Conversational entry point for reviewing results |

## Scripts

| Script | Description |
|--------|-------------|
| `append-iteration-log.js` | Appends a Phase A/B iteration entry to iteration-log.json |
| `build-leaderboard.js` | Builds pain-leaderboard.html from archived runs |
| `build-summary.js` | Writes evaluation-summary.json without HTML generation (`--no-report` path) |
| `check-exit-condition.js` | Decides whether the Phase A fix loop should exit |
| `classify-tiers.js` | Keyword-driven AC tier classification → evaluation-report.csv |
| `compute-patience.js` | Applies deterministic patience formula to persona-results / journey-log |
| `eval_state.py` | Read/write eval-state.yaml (init, set, get, timestamp) |
| `extract-nav-context.js` | Deterministic routes/nav extractor → navigation-hints.json |
| `generate-dashboard.js` | Builds a multi-eval dashboard HTML from an evals directory |
| `generate-journey-script.js` | Emits journey-test.mjs from component-map + extract-state |
| `generate-report.sh` | Thin shell wrapper for validate → render → log → optional leaderboard |
| `generate-thinkaloud-md.js` | Formats persona think-aloud traces to markdown |
| `list-failing-acs.js` | Lists FAIL/FLAGGED AC IDs from evaluation-report.csv |
| `log-run.js` | Appends a run to run-log.csv and archives key artifacts |
| `publish-report.sh` | Publishes evaluation-report.html to GitLab Pages / reports branch |
| `render-report.js` | Renders self-contained evaluation-report.html from artifacts |
| `resolve-root.js` | Resolves the prototype-creator project root for scripts |
| `sync-sheet.js` | Syncs run results to Google Sheets (when auth is configured) |
| `validate-artifacts.js` | Pre-flight schema check before report render |
| `validate-fix-log.js` | Validates fix-log.json schema |
| `validate-verdicts.js` | Bidirectional CSV ↔ journey-log verdict consistency check |
| `bootstrap-usability-testing.sh` | Bootstraps personas + 7-dimension rubric into `.context/` |
| `bootstrap-consistency-checker.sh` | Bootstraps PatternFly design guidelines into `.context/` |

## Prerequisites

```bash
# All at once:
make context

# Or individually:
bash .claude/skills/eval/scripts/bootstrap-usability-testing.sh    # Personas + 7-dimension rubric
bash .claude/skills/eval/scripts/bootstrap-consistency-checker.sh  # PatternFly design guidelines
```

| Directory | Source | Required for |
|-----------|--------|--------------|
| `.context/usability-testing/` | automated-usability-testing | Phase B scoring |
| `.context/consistency-checker/` | consistency-checker | Design violations |

## Two Modes

**Default (auto-fix):** The pipeline finds issues and fixes them, iterating until ACs pass. Every change is logged transparently. Use for CI and automated workflows.

**Report-only (`--no-fix`):** The pipeline evaluates without touching the code. Findings go to `refinement-suggestions.json` for human review. Use when designers want to understand what's wrong without automatic changes.
