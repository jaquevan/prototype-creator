# Prototype Creator

Takes RFE user stories and produces rapid prototypes that make the proposed experience tangible before engineering commits. Sits between [rfe-creator](https://github.com/jwforres/rfe-creator) (upstream — the **WHAT**) and [strat-creator](https://github.com/ederign/strat-creator) (downstream — the **HOW**). prototype-creator is the **SHOW** — making the vision concrete through clickable prototypes so teams can see, critique, and decide before a single line of production code is written. Integrates with [decision-kit](https://github.com/jnemargut/decision-kit) to surface design decisions at every meaningful junction and keep humans in the loop.

## What This Does

Given an RFE (from the `rfe-creator` pipeline or Jira directly), this pipeline:

1. **Create** — Generates a prototype from RFE user stories at a specified fidelity level (`prototype-create`)
2. **Review** — Scores the prototype against a UX quality rubric across four dimensions (`prototype-review`)
3. **Refine** — Iterates based on review feedback and human direction (`prototype-refine`)
4. **Test** — Runs simulated usability and desirability testing (`prototype-test-usability`, `prototype-test-desirability`)
5. **Submit** — Publishes the finished prototype to a target system (`prototype-submit`)

Steps 1–2 can run fully automated in CI. Steps 3–5 are iterative and benefit from human involvement.

## Workflows

### CI Pipeline (automated)

```
RFE (Jira) → prototype.create --fidelity=low --mode=auto
           → prototype.review
           → prototype.submit
```

Prototypes scoring **6+ total** (no zeros across four dimensions) receive the `prototype-creator-rubric-pass` label. Everything else gets `prototype-creator-needs-attention`.

### Human-in-the-Loop Pipeline

```
RFE (Jira) → prototype.create --fidelity=medium --mode=decide [--workspace=/path/to/repo]
               ├── Analyze target codebase (if --workspace is set)
               ├── Decision 1: Layout pattern        [human picks]
               ├── Decision 2: Core interaction       [human picks]
               ├── Decision 3: Information density    [human picks]
               ├── Decision 4: Visual tone            [human picks]
               └── Decision 5: Key components         [human picks]
           → prototype.review
           → prototype.refine
           → prototype.test-usability
           → prototype.test-desirability
           → prototype.submit
```

In `decide` mode, the pipeline produces a [decision-kit](https://github.com/jnemargut/decision-kit) artifact at each junction — a browsable page with options, visual previews, tradeoffs, and a side-by-side comparison. Nothing advances without human judgment.

Adding `--workspace` makes the pipeline target an existing codebase — see [Standalone vs. Workspace Mode](#standalone-vs-workspace-mode) for details.

### Local Human Review

After CI finishes, humans pull prototypes into the `local/` workspace to iterate:

```
/prototype.pull PROJ-298        # Pull post-CI prototype into local/
/prototype.refine               # Iterate locally
/prototype.review               # Re-score locally
/prototype.push PROJ-298        # Resubmit to CI
```

Skills auto-detect local mode when files are in `local/` — they skip Jira writes and pipeline label gates.

## UX Quality Rubric

Prototypes are scored across four dimensions (0–2 each, 8 total possible):

| Dimension | What It Measures |
|---|---|
| **Completeness** | Does the prototype cover the RFE's user stories and acceptance criteria? |
| **Usability** | Is the interaction pattern clear and free of obvious friction? (Nielsen's 10 heuristics) |
| **Feasibility** | Can this be built with the target design system (PatternFly 6)? |
| **Fidelity Match** | Does the prototype match the requested fidelity level — not over or under-engineered? |

**Pass threshold**: 6+ total with no zeros.

Scoring is handled by the restricted `prototype-scorer` agent — no shell, no network, no MCP. One invocation per dimension ensures scores are deterministic and auditable.

## Fidelity Levels

| Level | Style | Components | Interactions | Time |
|---|---|---|---|---|
| **Low** | Wireframe | Placeholder boxes | Static | ~2–3 min |
| **Medium** | Realistic | PatternFly 6 | Key flows | ~5–10 min |
| **High** | Production-ready | Full design system | All flows + edge cases | ~15–30 min |

## Implementation Status

| Component | Status | Description |
|---|---|---|
| `CLAUDE.md` | Done | Project instructions and context |
| `config/pipeline-settings.yaml` | Done | Jira JQL, scoring thresholds, defaults |
| `config/ux-rubric.yaml` | Done | Four-dimension scoring rubric |
| `config/fidelity-profiles.yaml` | Done | Low/medium/high fidelity definitions |
| `.claude/agents/prototype-scorer.md` | Done | Restricted scoring agent |
| `.claude/skills/prototype-pull/` | Done | Pull post-CI prototype into local/ |
| `.claude/skills/prototype-push/` | Done | Push local prototype back to CI |
| `.claude/skills/prototype-create/` | Planned | Generate prototype from RFE |
| `.claude/skills/prototype-review/` | Planned | Orchestrate scoring across dimensions |
| `.claude/skills/prototype-refine/` | Planned | Iterate based on feedback |
| `.claude/skills/prototype-test-usability/` | Planned | Simulated usability testing |
| `.claude/skills/prototype-test-desirability/` | Planned | Simulated desirability testing |
| `.claude/skills/prototype-submit/` | Planned | Publish to target system |
| `.claude/skills/prototype-speedrun/` | Planned | End-to-end orchestrator |
| `.claude/skills/prototype-common/` | Planned | Shared utilities |
| `templates/` | Planned | HTML layout and component templates |
| `scripts/` | Planned | Python scripts (context fetch, bootstrap) |
| `tests/` | Planned | Test suite |

## Project Structure

```
prototype-creator/
├── .claude/
│   ├── settings.json                      # Permissions and tool allowlist
│   ├── skills/                            # Claude Code skills (pipeline steps)
│   │   ├── prototype-create/              # Generate prototype from RFE
│   │   ├── prototype-refine/              # Iterate on existing prototype
│   │   ├── prototype-review/              # Score against UX rubric
│   │   ├── prototype-test-usability/      # Simulated usability testing
│   │   ├── prototype-test-desirability/   # Simulated desirability testing
│   │   ├── prototype-submit/              # Publish prototype
│   │   ├── prototype-speedrun/            # End-to-end orchestrator
│   │   ├── prototype-pull/                # Pull from CI into local/
│   │   ├── prototype-push/               # Push local changes back to CI
│   │   └── prototype-common/              # Shared utilities
│   └── agents/
│       └── prototype-scorer.md            # Restricted scoring agent
├── config/
│   ├── pipeline-settings.yaml             # Jira JQL, thresholds, defaults
│   ├── ux-rubric.yaml                     # Four-dimension scoring rubric
│   └── fidelity-profiles.yaml             # Low/medium/high profiles
├── templates/                             # HTML layout and component templates
│   ├── layouts/                           # Base page layouts per fidelity
│   ├── components/                        # Reusable component snippets
│   └── decision-pages/                    # Decision artifact templates
├── scripts/                               # Python scripts
│   ├── fetch-design-system-context.sh     # Fetch PatternFly docs
│   └── bootstrap-decision-kit.sh          # Bootstrap decision-kit skills
├── .context/                              # Fetched at runtime (gitignored)
│   ├── design-system/                     # PatternFly component docs + tokens
│   ├── research-context/                  # UX research (personas, JTBD)
│   └── decision-kit/                      # Vendored decision-kit skills
├── local/                                 # Human review workspace (gitignored)
│   ├── prototypes/                        # Pulled prototypes for iteration
│   ├── prototype-reviews/                 # Local review scores
│   ├── decisions/                         # Local decision artifacts
│   └── prototype-originals/               # Baseline snapshots for diffing
├── artifacts/                             # Pipeline output (gitignored)
│   ├── prototypes/                        # Generated prototypes
│   ├── prototype-reviews/                 # Review scores
│   └── decisions/                         # Decision artifacts
├── docs/                                  # Documentation
├── tests/                                 # Test suite
├── CLAUDE.md                              # Project instructions for AI agents
├── README.md                              # This file
├── pyproject.toml                         # Python project config
├── Makefile                               # Build and test targets
└── .gitignore
```

## Quick Start

### Setup

```bash
cd prototype-creator
uv sync
```

### Fetch Context

```bash
# Fetch PatternFly design system docs
bash scripts/fetch-design-system-context.sh

# Bootstrap decision-kit thinking skills
bash scripts/bootstrap-decision-kit.sh
```

### Run a Prototype (CI mode)

```bash
# Generate a low-fidelity prototype from an RFE
/prototype.create PROJ-298 --fidelity=low --mode=auto

# Review against the UX rubric
/prototype.review PROJ-298

# Submit if it passes
/prototype.submit PROJ-298
```

### Run a Prototype (human-in-the-loop)

```bash
# Generate a medium-fidelity prototype with decision points
/prototype.create PROJ-298 --fidelity=medium --mode=decide

# Review and iterate
/prototype.review PROJ-298
/prototype.refine PROJ-298

# Run simulated testing
/prototype.test-usability PROJ-298
/prototype.test-desirability PROJ-298

# Submit when satisfied
/prototype.submit PROJ-298
```

### Run a Prototype (targeting an existing codebase)

```bash
# Build on a local repo — generates React/Angular/etc. components
/prototype.create PROJ-298 --fidelity=medium --mode=decide --workspace=/path/to/your/repo

# Or target a remote repo — cloned automatically, branch auto-detected
/prototype.create PROJ-298 --workspace=https://gitlab.example.com/org/repo/-/tree/3.5

# Override the branch if needed
/prototype.create PROJ-298 --workspace=https://gitlab.example.com/org/repo --branch=release-3.5
```

### Local Review Workflow

```bash
# Pull a post-CI prototype for human review
/prototype.pull PROJ-298

# Iterate locally (skills auto-detect local mode)
/prototype.refine
/prototype.review

# Push back to CI when ready
/prototype.push PROJ-298
```

## Standalone vs. Workspace Mode

By default, prototypes are generated as **standalone HTML** — self-contained files you can open in any browser with no build step. This is the fastest way to explore an idea.

When you pass `--workspace`, the pipeline targets an **existing codebase** instead. It analyzes the repo's tech stack, conventions, and file structure, then generates code that fits naturally into the project — React components for a React app, Angular components for Angular, etc. The new feature integrates with existing routing, navigation, and design system usage.

### Standalone (default)

```bash
/prototype.create PROJ-298 --fidelity=medium --mode=auto
```

Output goes to `.artifacts/PROJ-298/prototype/` as self-contained HTML files using PatternFly CDN.

### Workspace — local path

```bash
/prototype.create PROJ-298 --fidelity=medium --mode=decide --workspace=/path/to/your/repo
```

The pipeline reads the codebase at the given path and writes new files directly into it, matching its conventions. A changeset manifest (`.artifacts/PROJ-298/changeset.md`) tracks every file created or modified. Lint and build verification run automatically against the target repo's rules.

### Workspace — git URL

```bash
/prototype.create PROJ-298 --workspace=https://gitlab.example.com/org/repo/-/tree/3.5
```

The pipeline clones the repo into `.artifacts/PROJ-298/workspace/`, detects the branch from the URL, and works against the clone. Embedded branches are auto-detected from GitLab (`/-/tree/<branch>`), GitHub (`/tree/<branch>`), and URL fragments (`#<branch>`).

Use `--branch` to override the detected branch or specify one when the URL doesn't include it:

```bash
/prototype.create PROJ-298 --workspace=https://gitlab.example.com/org/repo --branch=release-3.5
```

### What changes in workspace mode

| Aspect | Standalone | Workspace |
|---|---|---|
| **Output format** | Self-contained HTML + inline CSS/JS | Components in the target's tech stack (React, Angular, etc.) |
| **Output location** | `.artifacts/{ID}/prototype/` | Directly in the target codebase |
| **Codebase analysis** | Skipped | Analyzes tech stack, conventions, existing patterns |
| **Design system** | PatternFly CDN (medium/high fidelity) | Whatever the codebase already uses |
| **Navigation** | Links between HTML files | Integrated with existing routing and nav |
| **Post-change verification** | Skipped | Runs lint + build against the repo's rules |
| **Changeset tracking** | N/A | `.artifacts/{ID}/changeset.md` lists all files touched |

## Flags Reference

| Flag | Values | Default | Description |
|---|---|---|---|
| `--workspace` | Local path or git URL | *(none — standalone mode)* | Target codebase to modify. When set, output is code changes in the target's tech stack. When omitted, generates standalone HTML. |
| `--branch` | Branch name | *(auto-detected from URL)* | Git branch to clone when `--workspace` is a git URL. Overrides any branch detected from the URL. Ignored for local paths. |
| `--fidelity` | `low`, `medium`, `high` | `medium` | Wireframe → realistic design system components → production-ready. |
| `--mode` | `auto`, `decide` | `auto` | AI decides everything vs. stops at each design decision for human input. |
| `--depth` | `under`, `normal`, `over` | `normal` | How many decisions to surface: 2–3 (`under`), 4–7 (`normal`), 8–12 (`over`). Only meaningful in `decide` mode. |
| `--dry-run` | *(flag)* | off | Skip all external writes (Jira label updates). Still produces all local artifacts. |

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

## Related Projects

| Project | Role | Relationship |
|---|---|---|
| [rfe-creator](https://github.com/jwforres/rfe-creator) | Phase 1: The WHAT | Upstream — creates and assesses RFEs that feed into prototyping |
| **prototype-creator** | Phase 2: The SHOW | This project — makes the experience tangible |
| [strat-creator](https://github.com/ederign/strat-creator) | Phase 3: The HOW | Downstream — takes approved prototypes and creates implementation strategies |
| [decision-kit](https://github.com/jnemargut/decision-kit) | Decision support | Integrated — surfaces design decisions as browsable artifacts |
| [assess-rfe](https://github.com/n1hility/assess-rfe) | Quality scoring | Pattern reference — rubric-based scoring approach |

## Development

### Setup

```bash
uv sync
```

### Running Tests

```bash
make test
```

### Adding a New Skill

1. Create a folder under `.claude/skills/` with the skill name
2. Add a `SKILL.md` with the frontmatter and procedure
3. Follow the patterns in existing skills (`prototype-pull`, `prototype-push`)

### Adding a New Rubric Dimension

1. Add the dimension to `config/ux-rubric.yaml` under `dimensions:`
2. Define score levels 0, 1, 2 with criteria
3. Update `config/pipeline-settings.yaml` to include the new dimension in `scoring.dimensions`
4. Update the pass threshold if needed
5. Add evaluation guidance in `.claude/agents/prototype-scorer.md`
