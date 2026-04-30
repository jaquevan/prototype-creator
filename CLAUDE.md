# prototype-creator

Takes RFE user stories and produces rapid prototypes that make the proposed experience tangible before engineering commits. Integrates with decision-kit to surface design decisions at every meaningful junction and keep humans in the loop.

## What This Does

Given an RFE (from the `rfe-creator` pipeline or Jira directly), this pipeline:

1. Creates a prototype from RFE user stories (`prototype-create`)
2. Reviews the prototype against a UX quality rubric (`prototype-review`)
3. Optionally refines based on review feedback (`prototype-refine`)
4. Runs simulated usability testing (`prototype-test-usability`)
5. Runs simulated desirability testing (`prototype-test-desirability`)
6. Publishes the prototype to a target system (`prototype-submit`)

Steps 1–2 can run in CI. Steps 3–5 are iterative and benefit from human involvement. Step 6 is a push action.

## Two Modes

### `--mode=auto` (CI / batch)

AI makes all design decisions autonomously. Good for generating quick low-fidelity prototypes at scale. Produces a batch-review page at the end so humans can inspect results.

### `--mode=decide` (human-in-the-loop)

At each significant design decision point, the pipeline stops and produces a decision-kit artifact — a browsable HTML page with options, visual previews, tradeoffs, and a side-by-side comparison. The human picks. The prototype builds on their choices. Nothing advances without human judgment.

Decision points in `decide` mode:
- Layout pattern (list view, card grid, dashboard, wizard, etc.)
- Interaction model (inline editing, modals, drawers, etc.)
- Information density (progressive disclosure, tabs, expandable sections)
- Visual tone (utilitarian, friendly, data-dense, conversational)
- Key component choices (which design system components for critical UI elements)

## Fidelity Levels

- `--fidelity=low` — Wireframe-style, placeholder boxes, static click-throughs
- `--fidelity=medium` — Realistic design system components, key flows wired up
- `--fidelity=high` — Production-ready fidelity, all flows including edge cases and error states

## Workflows

### CI Pipeline (automated)

```
RFE (Jira) → prototype.create --fidelity=low --mode=auto
           → prototype.review
           → prototype.submit
```

Prototypes scoring 6+ total (no zeros) get `prototype-creator-rubric-pass`. Everything else gets `prototype-creator-needs-attention`.

### Human-in-the-loop Pipeline

```
RFE (Jira) → prototype.create --fidelity=medium --mode=decide
               ├── Decision 1: Layout pattern      [human picks]
               ├── Decision 2: Core interaction     [human picks]
               ├── Decision 3: Information density   [human picks]
               ├── Decision 4: Visual tone          [human picks]
               └── Decision 5: Key components       [human picks]
           → prototype.review
           → prototype.refine
           → prototype.test-usability
           → prototype.test-desirability
           → prototype.submit
```

### Local Human Review

After CI finishes, humans use the `local/` workspace to iterate:

```
/prototype.pull PROJ-298       # Pull post-CI prototype into local/
/prototype.refine                  # Iterate locally
/prototype.review                  # Re-score locally
/prototype.push PROJ-298       # Resubmit to CI
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
│   │   ├── prototype-pull/            # Pull from CI into local/
│   │   ├── prototype-push/            # Push local changes back to CI
│   │   └── prototype-common/          # Shared utilities (symlinked)
│   └── agents/
│       └── prototype-scorer.md        # Restricted scoring agent
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
├── local/                             # Human review workspace (gitignored)
├── artifacts/                         # Pipeline output (gitignored)
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
