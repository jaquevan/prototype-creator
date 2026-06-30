# Prototype Eval Pipeline

Evaluates prototypes against Jira acceptance criteria and runs persona-based usability testing. Produces an HTML report with a narrative summary, expandable findings, and full evidence (screenshots, think-aloud traces, dimension scores).

## Target Outcome

The report is a **confidence gate + iteration driver** for designers:

- **If the prototype passes:** The designer knows it's ready and can approve it. One clear verdict, no guesswork.
- **If issues exist:** The designer knows exactly what needs fixing, why, and what to do next. Actionable, not informational.
- **If items need human judgment:** The designer sees what the AI couldn't verify and can make their own call with evidence.

The report answers three questions in under 10 seconds: *Did it pass? What needs my attention? What do I do next?*

## Quick Start

```bash
# 1. Bootstrap context (required for usability scoring)
make context

# 2. Start your prototype locally
cd ~/Desktop/rhoai-prototypes && npm start

# 3. Run the eval
/eval-iterate RHAISTRAT-1536 http://localhost:3000 --workspace=~/Desktop/rhoai-prototypes
```

The pipeline runs, opens the report when done, and presents a summary with suggested actions.

## What It Does

The pipeline has two phases:

**Phase A — AC Validation (X-Ray)**
An informed evaluator with full source access verifies each acceptance criterion from the Jira ticket using Playwright. If criteria fail, it applies fixes and re-runs (up to N iterations) until all pass or max iterations are reached.

**Phase B — Usability Testing (Blind)**
Per-persona Playwright walkthroughs where simulated users navigate the prototype at their own competence level. Produces think-aloud traces and scores 7 usability dimensions.

```
Phase A: eval-extract → eval-consistency → eval-classify → eval-journey (informed)
                                                             ↓
                                                     All PASS? → Phase B
                                                     FAIL? → eval-fix → loop
                                                     
Phase B: eval-usability (per-persona Playwright) → eval-report → open + summarize
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--workspace=PATH` | — | Path to the prototype repo (enables code fixes) |
| `--max-iterations=N` | 3 | Max fix loop iterations in Phase A |
| `--usability=deep\|skip` | deep | Run or skip Phase B persona walkthroughs |
| `--no-iterate` | Off | Run Phase A once, no fix loop |
| `--no-fix` | Off | Pure evaluation — skip fixes, produce findings only |
| `--depth=deep` | deep | Evaluation thoroughness |

## Output Artifacts

All output goes to `.artifacts/<KEY>/` (gitignored):

| File | Description |
|------|-------------|
| `evaluation-report.html` | Self-contained HTML report with narrative summary |
| `evaluation-report.csv` | Machine-readable AC verdicts + usability scores |
| `journey-log.json` | Playwright step log, screenshots, usability overlays |
| `extract-state.json` | Jira context, personas, MR delta |
| `refinement-suggestions.json` | Suggested fixes for failed criteria |
| `screenshots/` | Step-by-step and persona walkthrough screenshots |
| `usability-thinkaloud-<persona>.md` | Per-persona think-aloud traces |
| `consistency-report.json` | PatternFly design guideline violations |
| `iteration-log.json` | Per-iteration pass/fail counts |

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
| `eval-hint` | Extracts navigation hints from workspace source |
| `eval-journey` | Runs Playwright walkthroughs (informed mode for Phase A) |
| `eval-fix` | Applies fixes from refinement-suggestions.json |
| `eval-usability` | Phase B persona walkthroughs + 7-dimension scoring |
| `eval-consistency` | PatternFly design guideline compliance check |
| `eval-report` | Renders the HTML report from artifacts |
| `eval-review` | Conversational entry point for reviewing results |

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
