# prototype-creator

Takes RFE user stories and produces rapid prototypes that make the proposed experience tangible before engineering commits. Can modify an existing prototype codebase or generate standalone HTML. Integrates with decision-kit to surface design decisions dynamically at every meaningful junction and keep humans in the loop.

## What This Does

Given an RFE (from the `rfe-creator` pipeline or Jira directly), this pipeline:

1. Analyzes the RFE and target codebase (`prototype-create`)
2. Surfaces dynamic design decisions for human judgment (`prototype-create --mode=decide`)
3. Generates prototype code — either as changes to an existing codebase (`--workspace`) or standalone HTML
4. Reviews the prototype against a UX quality rubric (`prototype-review`)
5. Optionally refines based on review feedback (`prototype-refine`)
6. Runs simulated usability testing (`prototype-test-usability`)
7. Runs simulated desirability testing (`prototype-test-desirability`)
8. Publishes the prototype to a target system (`prototype-submit`)

Steps 1–4 can run in CI. Steps 5–7 are iterative and benefit from human involvement. Step 8 is a push action.

## Two Modes

### `--mode=auto` (CI / batch)

AI makes all design decisions autonomously. Good for generating quick low-fidelity prototypes at scale. Produces a batch-review page at the end so humans can inspect results.

### `--mode=decide` (human-in-the-loop)

At each significant design decision point, the pipeline stops and produces a decision-kit artifact — a browsable HTML page with options, visual previews, tradeoffs, and a side-by-side comparison. The human picks. The prototype builds on their choices. Nothing advances without human judgment.

Decision points are **dynamic, not a fixed set.** The AI analyzes the RFE and target codebase to identify 4–7 decisions that have genuine tradeoffs. Decisions the AI is confident about are auto-resolved with a note. Decision count is configurable via `--depth`:
- `--depth=under` — 2–3 highest-stakes decisions only
- `--depth=normal` — 4–7 context-dependent decisions (default)
- `--depth=over` — 8–12 decisions for thorough exploration

All decisions are stored in `.artifacts/{ID}/decisions/` following the [decision-kit spec](https://github.com/jnemargut/decision-kit).

## Fidelity Levels

- `--fidelity=low` — Wireframe-style, placeholder boxes, static click-throughs
- `--fidelity=medium` — Realistic design system components, key flows wired up
- `--fidelity=high` — Production-ready fidelity, all flows including edge cases and error states

## Workflows

### CI Pipeline (automated, standalone HTML)

```
RFE (Jira) → prototype.create --fidelity=low --mode=auto
           → prototype.review
           → prototype.submit
```

Prototypes scoring 6+ total (no zeros) get `prototype-creator-rubric-pass`. Everything else gets `prototype-creator-needs-attention`.

### Human-in-the-loop Pipeline (targeting an existing codebase)

```
RFE (Jira) → prototype.create --fidelity=medium --mode=decide --workspace=/path/to/repo
               ├── Analyze target codebase
               ├── Plan decisions dynamically (4–7 based on RFE + codebase)
               ├── Decision 1: [context-specific]   [human picks]
               ├── Decision 2: [context-specific]   [human picks]
               ├── ...
               └── Decision N: [context-specific]   [human picks or auto-resolved]
           → Generate code changes in the target codebase
           → prototype.review
           → prototype.refine
           → prototype.test-usability
           → prototype.test-desirability
           → prototype.submit --target=repo
```

### Local Human Review

After CI finishes, humans use `/prototype.pull` to switch a prototype into local mode for iteration:

```
/prototype.pull PROJ-298       # Switch prototype to local mode (skips Jira writes)
/prototype.refine              # Iterate locally
/prototype.review              # Re-score locally
/prototype.push PROJ-298       # Reset to CI mode for re-review
```

## Project Structure

```
prototype-creator/
├── .claude/
│   ├── skills/                        # Claude Code skills (pipeline steps)
│   │   ├── prototype-create/          # Generate prototype from RFE
│   │   ├── prototype-refine/          # Iterate on existing prototype
│   │   ├── prototype-review/          # Score against UX rubric
│   │   ├── prototype-test-usability/  # Simulated usability testing
│   │   ├── prototype-test-desirability/ # Simulated desirability testing
│   │   ├── prototype-submit/          # Publish prototype
│   │   ├── prototype-speedrun/        # End-to-end orchestrator
│   │   ├── prototype-pull/            # Switch prototype to local mode
│   │   ├── prototype-push/            # Reset prototype to CI mode
│   │   └── prototype-common/          # Shared utilities (symlinked)
│   └── agents/
│       └── prototype-scorer.md        # Restricted scoring agent
├── .artifacts/                        # All pipeline output, per-RFE (gitignored)
│   ├── {ID}/                          # e.g., RHAISTRAT-1536/
│   │   ├── decisions/                 # Decision artifacts (decision-kit format)
│   │   │   ├── decisions.json         # Machine-readable decision state
│   │   │   ├── strategy-brief.md      # Summary of all decisions
│   │   │   ├── decision-001.html      # Per-decision visual pages
│   │   │   └── index.html             # Decision landing page
│   │   ├── prototype/                 # Prototype code (HTML or workspace files)
│   │   ├── reviews/                   # Review scores per dimension
│   │   ├── metadata.json              # Run metadata and mode (ci/local)
│   │   ├── rfe-snapshot.md            # Frozen RFE content at creation time
│   │   ├── changeset.md               # Files created/modified (workspace mode)
│   │   ├── workspace-analysis.json    # Target codebase analysis (workspace mode)
│   │   ├── pipeline-config.yaml       # Parsed flags for context survival
│   │   └── pipeline-progress.yaml     # Step-by-step progress tracking
│   ├── submissions.md                 # Cross-ID submission manifest
│   └── pipeline-complete.json         # CI completion signal
├── scripts/                           # Python scripts
├── config/                            # Pipeline and rubric configuration
├── templates/                         # HTML layout and component templates
│   ├── layouts/                       # Base page layouts
│   ├── components/                    # Reusable component snippets
│   └── decision-pages/               # Decision artifact templates
├── .context/                          # Fetched at runtime (gitignored)
│   ├── design-system/                 # PatternFly component docs + tokens
│   ├── research-context/              # UX research (personas, JTBD, top tasks)
│   └── decision-kit/                  # Vendored decision-kit thinking skills
├── docs/                              # Documentation
├── tests/                             # Test suite
├── pyproject.toml
├── Makefile
└── CLAUDE.md                          # This file
```

## Related Projects

- [rfe-creator](https://github.com/jwforres/rfe-creator) — Phase 1: RFE creation and assessment (upstream input)
- [strat-creator](https://github.com/ederign/strat-creator) — Phase 3: Strategy creation from approved RFEs (downstream consumer)
- [decision-kit](https://github.com/jnemargut/decision-kit) — Decision Driven Development toolkit (integrated for human-in-the-loop decisions)
- [assess-rfe](https://github.com/n1hility/assess-rfe) — RFE quality scoring rubric (pattern reference)

## Development

### Setup

```
uv sync
```

### Running Tests

```
make test
```

### Fetching Context

```bash
# Fetch design system docs (PatternFly)
bash scripts/fetch-design-system-context.sh

# Bootstrap decision-kit skills into .context/
bash scripts/bootstrap-decision-kit.sh
```

$ARGUMENTS
