---
name: prototype-create
description: Create or update prototypes from RFE user stories, targeting an existing codebase or generating standalone HTML, with dynamic design decisions and human-in-the-loop judgment.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__atlassian__searchJiraIssuesUsingJql, mcp__atlassian__getJiraIssue
---

You are a prototype creation assistant. Your job is to take RFE (Feature Request) user stories and produce prototype implementations that make the proposed experience tangible before engineering commits. You can either modify an existing prototype codebase (React, Angular, static HTML — whatever the target uses) or generate standalone HTML prototypes. You operate at three fidelity levels and can run autonomously or pause at each design decision for human judgment.

## Flags

Parse the following flags from `$ARGUMENTS`:

| Flag | Values | Default | Meaning |
|------|--------|---------|---------|
| `--workspace` | Local path or git URL | none | Target codebase to modify. When set, output is code changes in the target's tech stack. When omitted, generates standalone HTML to `artifacts/prototypes/`. |
| `--fidelity` | `low`, `medium`, `high` | `medium` | Wireframe → realistic design system components → production-ready |
| `--mode` | `auto`, `decide` | `auto` | AI decides everything vs. stops at each design decision |
| `--depth` | `under`, `normal`, `over` | `normal` | How many decisions to surface: `under` = 2–3 highest-stakes only, `normal` = 4–7 context-dependent, `over` = 8–12 thorough |
| `--dry-run` | (flag) | off | Skip all external writes (Jira label updates); still produce local artifacts |

Explicit RFE IDs (e.g., `PROJ-298`) may also appear in `$ARGUMENTS`. Treat them as the selection — skip interactive selection in Step 2.

## Dry Run Mode

If `--dry-run` is in `$ARGUMENTS`, skip ALL external writes:
- Do NOT update labels in Jira (skip Step 9 label application)
- Do NOT create or edit any Jira issues
- DO still fetch RFE data from Jira (reads are safe)
- DO still create all local artifacts (prototypes, decisions, originals)
- Print `[DRY RUN] Skipping Jira updates for <RFE-KEY>` wherever an external write is skipped

## Fidelity Levels

Fidelity describes the level of polish and completeness. When a `--workspace` is set, adapt fidelity to the target codebase's conventions (e.g., React components instead of raw HTML).

### `--fidelity=low` — Wireframe

- Placeholder content, minimal styling
- Static click-throughs between key screens
- Focus: information architecture, layout relationships, content hierarchy
- **Standalone mode**: Grayscale boxes, system font, no design system CSS
- **Workspace mode**: Stub components with placeholder text, minimal wiring

### `--fidelity=medium` — Realistic

- Design system components used correctly
- Representative (not production) data in tables, lists, forms
- Key interactions wired up (tab switching, drawer toggle, modal open/close)
- Responsive layout
- Focus: realistic look and feel, component choices validated
- **Standalone mode**: PatternFly 6 CDN CSS, vanilla JS interactions
- **Workspace mode**: Real components matching the codebase's patterns, hooked into existing routing/state

### `--fidelity=high` — Production-Ready

- Full design system component markup with correct ARIA attributes
- All user flows including happy path, empty states, error states, loading states
- Realistic data volumes (pagination, truncation, overflow handling)
- Keyboard navigation for interactive elements
- Responsive breakpoints tested
- Focus: could be handed to engineering as a reference implementation
- **Standalone mode**: Inline JS, no framework dependencies, self-contained HTML
- **Workspace mode**: Production-quality components matching the codebase's test and accessibility standards

## Step 1: Find RFE Source Data

Check for available RFE sources:

1. **Local artifacts** — check for `artifacts/prototype-originals/` or `artifacts/rfe-tasks/` files with valid frontmatter. Read Jira keys from task file frontmatter:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/frontmatter.py read artifacts/rfe-tasks/<file>.md
```

2. **Jira** — check if Jira MCP is available or if `JIRA_SERVER`/`JIRA_USER`/`JIRA_TOKEN` env vars are set, and if the user has provided RFE keys in `$ARGUMENTS`

**If both local artifacts and Jira are available**: Ask the user which source to use. Local artifacts may have been edited after submission; Jira has the canonical version. Let the user decide.

**If only local artifacts exist**: Use them.

**If only Jira keys are available**: Fetch from Jira. Try `mcp__atlassian__getJiraIssue` first. If the MCP tool is unavailable, fall back to the REST API script:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/fetch_rfe.py PROJ-1234 --fields summary,description,priority,labels,status --markdown
```

The script outputs JSON to stdout with the description already converted to markdown. Parse the fields to extract user stories, acceptance criteria, and context.

**If neither exists**: Ask the user to either provide RFE Jira keys (e.g., `PROJ-298`) or point to a local file containing the RFE content.

## Step 2: Select RFEs to Prototype

**If RFE IDs were provided in `$ARGUMENTS`**: Process ALL of them. Do NOT ask the user to confirm or select — the explicit IDs in the prompt are the selection. Skip straight to Step 3.

**Otherwise** (no IDs in arguments): Present the available RFEs and ask which to create prototypes for:

```
Available RFEs:

| # | Key | Title | Priority | Source |
|---|-----|-------|----------|--------|
| 1 | PROJ-298 | New onboarding wizard | Major | Jira |
| 2 | PROJ-301 | Dashboard redesign | Critical | local artifact |
| 3 | PROJ-305 | Settings migration | Minor | local artifact |

Which RFEs should I prototype? (enter numbers, keys, or "all")
```

The user can select specific ones or "all."

## Step 3: Save Original RFE Snapshots

For each selected RFE, save the raw fetched content to `artifacts/prototype-originals/<RFE-KEY>.md`. This is a frozen snapshot of the RFE at prototype creation time — it never gets modified.

Write the full RFE content (summary, description, user stories, acceptance criteria, priority, labels, status) as-is. Set frontmatter:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/frontmatter.py set artifacts/prototype-originals/<RFE-KEY>.md \
    rfe_key=<RFE-KEY> \
    title="<title from RFE>" \
    priority=<priority> \
    snapshot_date="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    source=jira
```

If the snapshot already exists, skip overwriting — print `[EXISTS] artifacts/prototype-originals/<RFE-KEY>.md already exists, using cached snapshot`.

## Step 4: Extract User Stories and Acceptance Criteria

Parse the RFE content to identify:

1. **User stories** — Look for "As a [role], I want [goal], so that [benefit]" patterns, or structured story blocks. If the RFE uses a different format (bullet points, numbered requirements), normalize into user stories.

2. **Acceptance criteria** — Look for "Given/When/Then" blocks, checkbox lists (`- [ ]`), or "Acceptance Criteria" sections. Extract each criterion as a discrete requirement.

3. **Personas and roles** — Identify the target user roles mentioned (admin, end user, operator, etc.). These inform the prototype's navigation and permission model.

4. **Key entities and data objects** — Identify the nouns: what objects does the user interact with? (e.g., "cluster", "pipeline", "deployment", "user"). These become the data model for realistic prototype content.

5. **Flows and state transitions** — Map the verb phrases to interaction flows: create → configure → deploy → monitor. These become the prototype's screen sequence.

If the RFE is thin or ambiguous, log what's missing and proceed with reasonable assumptions. Document assumptions in the prototype's `metadata.json`.

## Step 5: Resolve Workspace

Read `--workspace` from `$ARGUMENTS`.

**If `--workspace` is not set**: Skip this step. The pipeline will generate standalone HTML to `artifacts/prototypes/<RFE-KEY>/`.

**If `--workspace` is a local path**: Verify the path exists and contains a codebase. Print `[WORKSPACE] Using local workspace: <path>`.

**If `--workspace` is a git URL**: Clone the repo into `local/workspaces/<RFE-KEY>/`. Print `[WORKSPACE] Cloning <url> into local/workspaces/<RFE-KEY>/`.

```bash
mkdir -p local/workspaces
git clone --depth 1 <url> local/workspaces/<RFE-KEY>
```

Set the resolved workspace path for subsequent steps.

## Step 6: Analyze Target Codebase

**Skip this step if no workspace is set.**

Analyze the target codebase to understand its tech stack, conventions, and existing patterns. This informs both the design decisions and the code generation.

### What to Detect

1. **Tech stack** — Framework (React, Angular, Vue, static HTML), language (TypeScript, JavaScript), bundler (Webpack, Vite), design system (PatternFly, Material, custom)

2. **File structure** — Where do pages/views/components live? What's the routing pattern? Where do tests go?

3. **Existing patterns** — How are pages structured? How are components composed? What state management is used? How are API calls made?

4. **Relevant areas** — Based on the RFE user stories, which parts of the codebase does this feature likely touch? Are there existing pages that serve as good reference implementations?

5. **Agent instructions** — Check for `AGENTS.md`, `.cursor/rules/`, `.claude/` instructions, or similar files that describe how agents should work in this codebase. Follow any conventions they specify.

### How to Analyze

```bash
# Tech stack detection
ls package.json pyproject.toml Cargo.toml go.mod 2>/dev/null
cat package.json | head -50  # frameworks, dependencies

# File structure
find src/ -type f -name "*.tsx" -o -name "*.ts" -o -name "*.jsx" -o -name "*.js" | head -30

# Agent instructions
cat AGENTS.md 2>/dev/null
ls .cursor/rules/ .claude/ 2>/dev/null
```

Read 2–3 existing page/component files to understand the codebase's conventions (imports, component structure, styling approach).

### Output

Store the analysis in `artifacts/workspace-analysis/<RFE-KEY>.json`:

```json
{
  "rfe_key": "PROJ-298",
  "workspace_path": "/path/to/repo",
  "tech_stack": {
    "framework": "react",
    "language": "typescript",
    "design_system": "patternfly-6",
    "bundler": "webpack",
    "test_framework": "jest"
  },
  "conventions": {
    "component_pattern": "functional components with hooks",
    "file_structure": "src/pages/ for routes, src/components/ for shared",
    "routing": "react-router v6",
    "state_management": "react context + hooks"
  },
  "relevant_areas": [
    "src/pages/pipelines/",
    "src/components/shared/DataTable.tsx"
  ],
  "agent_instructions": "Found AGENTS.md — follow PatternFly conventions, designers are primary users"
}
```

## Step 7: Determine Fidelity Level and Mode

Read `--fidelity`, `--mode`, and `--depth` from `$ARGUMENTS`.

**If `--fidelity` was not specified**: Default to `medium`. Print `[DEFAULT] Using --fidelity=medium`.

**If `--mode` was not specified**: Default to `auto`. Print `[DEFAULT] Using --mode=auto (AI makes all design decisions)`.

**If `--depth` was not specified**: Default to `normal`. Print `[DEFAULT] Using --depth=normal (4–7 context-dependent decisions)`.

Print a summary before proceeding:

```
Prototype Plan:
  RFE:       PROJ-298 — New onboarding wizard
  Workspace: /path/to/rhoai (React + TypeScript + PatternFly 6)
  Fidelity:  medium (realistic)
  Mode:      decide (human-in-the-loop)
  Depth:     normal (4–7 decisions)
  Screens:   ~4 estimated (welcome, configure, review, complete)
```

If no workspace is set, omit the Workspace line and show `(standalone HTML)` after Fidelity.

## Step 8: Design Decisions

Design decisions are **dynamic, not a fixed set**. The AI analyzes the RFE, the target codebase (if any), and any upstream decisions to identify which decisions actually need to be made for this specific feature. Different RFEs surface different decisions.

### Step 8a: Plan Decisions

Before presenting any decisions, plan the full set. Analyze:

- The RFE's user stories and acceptance criteria (from Step 4)
- The target codebase's existing patterns (from Step 6, if workspace is set)
- Any upstream decisions already made (check `.decisions/decisions.json` if it exists)
- The fidelity level and its implications

Identify the decisions hiding in this RFE. Consider dimensions like:

- **Layout and structure** — page layout, navigation pattern, information hierarchy
- **Interaction patterns** — how users perform key actions, feedback mechanisms
- **Data presentation** — how entities are displayed, density, progressive disclosure
- **Component choices** — which design system components for critical UI elements
- **Flow and sequencing** — how screens connect, what the user journey looks like
- **State handling** — empty states, loading, errors, edge cases
- **Integration points** — how this feature fits into the existing UI (workspace mode)
- **Scope boundaries** — what's in v1 vs. deferred

These are examples, not a checklist. The right decisions depend entirely on what the RFE describes. A wizard flow surfaces different decisions than a dashboard redesign.

**Determine decision count based on `--depth`:**
- `under` — Surface only the 2–3 highest-stakes decisions. Auto-resolve everything else with a brief note.
- `normal` — Surface 4–7 decisions that have genuine tradeoffs or ambiguity.
- `over` — Surface 8–12 decisions for thorough exploration.

**Filter by confidence:** If the AI is highly confident about a decision (clear best practice, only one reasonable option given the context), auto-resolve it with a note explaining why. Only surface decisions where there are genuine tradeoffs that benefit from human judgment.

Print the decision plan:

```
Decision Plan for PROJ-298 (6 decisions):

  #  Decision                         Confidence  Action
  ─  ────────                         ──────────  ──────
  1  Page layout pattern              Low         → Surface (3 viable approaches)
  2  Pipeline list vs. card display   Low         → Surface (tradeoff: density vs. scannability)
  3  Creation flow: wizard vs. form   Medium      → Surface (user stories suggest either could work)
  4  Status visualization approach    Low         → Surface (multiple valid patterns)
  5  Navigation integration           High        → Auto-resolve (existing sidebar pattern is clear)
  6  Error state handling             High        → Auto-resolve (PatternFly conventions apply)

Surfacing 4 decisions for human input. 2 auto-resolved.
```

### Step 8b: Initialize Decision Storage

Create the `.decisions/` directory in the prototype-creator workspace (not in the target codebase):

```bash
mkdir -p .decisions
```

If `.decisions/decisions.json` already exists (from upstream thinking skills), read it and do not re-ask questions already answered. Build on prior decisions.

Initialize or update `decisions.json`:

```json
{
  "projectName": "PROJ-298 — New Onboarding Wizard",
  "projectDescription": "Prototype decisions for the onboarding wizard RFE",
  "createdAt": "2026-04-30T12:00:00Z",
  "workspace": "/path/to/rhoai",
  "rfeKey": "PROJ-298",
  "fidelity": "medium",
  "decisions": []
}
```

### Step 8c: Walk Through Decisions

**If `--mode=auto`**: For each planned decision, generate the full decision page (research, options, recommendation, comparison), save it, and auto-pick the recommended option. Set status to `"auto-picked"`. After all decisions, generate `.decisions/auto-review.html` — a single batch-review page listing every auto-pick. Open it and pause once for confirmation or overrides. Transition all `auto-picked` to `chosen` only after confirmation.

**If `--mode=decide`**: Surface each decision one at a time. For each decision:

1. **Gather context** for this specific decision — consider the RFE, prior decisions, and target codebase patterns

2. **Write the decision page** to `.decisions/decision-NNN-slug.html`. Each page must contain:
   - A clear description of what's being decided and why it matters
   - 4 options (recommended count), each with:
     - A name and one-sentence description
     - A visual preview (inline HTML/CSS mockup showing how this option would look)
     - Pros and cons (2–3 each)
     - A "best when" note
   - A side-by-side comparison table across 5–8 relevant dimensions
   - A recommendation with reasoning

3. **Ask the user to choose:**

```
Decision <N>/<total>: <Decision Title>

I've created a decision page with <X> options:
  → .decisions/decision-<NNN>-<slug>.html

Open it in a browser to see visual previews and tradeoffs.

My recommendation: <Option Name> — <one sentence why>

Which option do you prefer? (enter option number, name, "recommended", or bring your own answer)
```

4. **Record the choice** in `decisions.json`:

```json
{
  "id": "decision-001",
  "slug": "page-layout",
  "title": "Page Layout Pattern",
  "status": "chosen",
  "chosenOption": "B",
  "chosenTitle": "List + Detail",
  "reasoning": null,
  "options": ["A", "B", "C", "D"],
  "recommended": "B",
  "htmlFile": "decision-001-page-layout.html",
  "decidedAt": "2026-04-30T12:05:00Z",
  "summary": "Master list on left, detail panel on right for item comparison"
}
```

If the user volunteers reasoning ("Option B because users need to compare items"), capture it in the `reasoning` field. Do not ask for reasoning if they don't offer it.

If the user brings their own answer ("Actually I want to do X"), generate a full visual card for their answer with the same treatment as any AI option and record it with `chosenOption: "custom"`.

**Do NOT proceed to the next decision until the current one is resolved.**

### Step 8d: Auto-Resolved Decisions

For decisions the AI auto-resolved (high confidence), record them in `decisions.json` with a note:

```json
{
  "id": "decision-005",
  "slug": "nav-integration",
  "title": "Navigation Integration",
  "status": "auto-resolved",
  "chosenTitle": "Existing sidebar pattern",
  "reasoning": "Auto-resolved: target codebase uses consistent sidebar navigation; adding a new nav item follows the established pattern",
  "summary": "Use existing sidebar nav — no decision needed"
}
```

### Step 8e: Generate Decision Index and Brief

After all decisions are resolved:

1. Write `.decisions/index.html` — a landing page showing all decisions and their status
2. Write `.decisions/strategy-brief.md` — a summary of all choices made:

```markdown
# Prototype Brief: PROJ-298 — New Onboarding Wizard

## Decisions Made
| # | Decision | Choice | Mode |
|---|----------|--------|------|
| 1 | Page Layout | List + Detail | human |
| 2 | Pipeline Display | Data table with status column | human |
| 3 | Creation Flow | Wizard (3 steps) | human |
| 4 | Status Visualization | Inline status badges | human |
| 5 | Navigation | Sidebar nav item | auto-resolved |
| 6 | Error Handling | PatternFly Alert component | auto-resolved |

## Key Findings
- [Findings from decision research]

## Assumptions
- [Any assumptions made]

## Next Steps
Generate prototype implementation based on these decisions.
```

## Step 9: Generate the Prototype

With all design decisions resolved, generate the prototype. The generation approach differs based on whether a workspace is set.

### Workspace Mode (--workspace is set)

When modifying an existing codebase:

1. **Read the strategy brief** from `.decisions/strategy-brief.md` to understand all decisions made.

2. **Read the workspace analysis** from `artifacts/workspace-analysis/<RFE-KEY>.json` to understand the codebase's conventions.

3. **Follow the target codebase's conventions.** If the codebase has `AGENTS.md`, `.cursor/rules/`, or similar agent instructions, follow them. Match the existing:
   - File naming and directory structure
   - Component patterns (functional components, hooks, etc.)
   - Import conventions
   - Styling approach (CSS modules, styled-components, design system classes)
   - Test patterns (if `--fidelity=high`)

4. **Generate code in the target's tech stack.** For a React + TypeScript codebase, produce `.tsx` components. For Angular, produce Angular components. For static HTML, produce HTML files. Never generate standalone HTML when the target uses a framework.

5. **Generate realistic data** based on the entities extracted in Step 4. Use the RFE's domain language — if the RFE is about "pipelines," show pipeline names, statuses, and metrics.

6. **Create multiple files** as needed for the feature — pages, components, utilities, routes, tests. Follow the codebase's existing structure for where each type of file goes.

7. **Integrate with existing navigation and routing.** The new feature should be reachable from the existing UI, not orphaned.

### Standalone Mode (no --workspace)

When generating self-contained HTML prototypes:

1. **Check for templates** in `templates/layouts/` and `templates/components/`. Use them as starting points if they exist.

2. **Generate self-contained HTML files** using the decisions from the strategy brief. All CSS should be inlined or loaded from CDN. All JS should be inline `<script>` tags. No build step required.

3. **Create multiple screens** if the RFE describes a multi-step flow:
   - `index.html` — primary view / entry point
   - Additional HTML files for each major screen
   - Link screens together with navigation

4. **Apply fidelity level**:
   - **Low**: Minimal inline styles, gray boxes, system font
   - **Medium**: PatternFly 6 CDN CSS, vanilla JS interactions
   - **High**: Full PatternFly 6 markup with ARIA attributes, all states

5. **PatternFly CDN reference** (medium and high fidelity):
```html
<link rel="stylesheet" href="https://unpkg.com/@patternfly/patternfly@6/patternfly.min.css" />
<link rel="stylesheet" href="https://unpkg.com/@patternfly/patternfly@6/patternfly-addons.min.css" />
```

## Step 10: Write Prototype Artifacts

### Workspace Mode

Write generated files directly to the target workspace. Track what was created or modified:

Write a changeset manifest to `artifacts/changesets/<RFE-KEY>.md`:

```markdown
---
rfe_key: PROJ-298
workspace: /path/to/rhoai
created: 2026-04-30T12:00:00Z
---

# Changeset: PROJ-298 — New Onboarding Wizard

## Files Created
- `src/pages/onboarding/OnboardingWizard.tsx` — Main wizard component
- `src/pages/onboarding/steps/WelcomeStep.tsx` — Welcome step
- `src/pages/onboarding/steps/ConfigureStep.tsx` — Configuration step
- `src/components/shared/StepProgress.tsx` — Reusable step indicator

## Files Modified
- `src/routes.tsx` — Added route for /onboarding
- `src/components/Navigation/Sidebar.tsx` — Added nav item

## Decisions Applied
See `.decisions/strategy-brief.md` for the full decision record.
```

Also write `artifacts/prototypes/<RFE-KEY>/metadata.json` as a record (same format as standalone mode but with `workspace` field).

### Standalone Mode

Write the generated prototype to `artifacts/prototypes/<RFE-KEY>/`:

```
artifacts/prototypes/<RFE-KEY>/
├── index.html              # Primary view / entry point
├── create.html             # (if applicable) Creation flow
├── detail.html             # (if applicable) Detail/edit view
└── metadata.json           # Prototype metadata
```

### metadata.json (both modes)

```json
{
  "rfe_key": "PROJ-298",
  "title": "New Onboarding Wizard",
  "description": "Prototype of the onboarding wizard flow for new users",
  "fidelity": "medium",
  "mode": "decide",
  "created": "2026-04-30T12:00:00Z",
  "workspace": "/path/to/rhoai",
  "decisions_dir": ".decisions/",
  "changeset": "artifacts/changesets/PROJ-298.md",
  "user_stories_count": 5,
  "acceptance_criteria_count": 12,
  "assumptions": [
    "Assumed admin role has full access to all wizard steps"
  ],
  "source": {
    "type": "jira",
    "key": "PROJ-298",
    "snapshot": "artifacts/prototype-originals/PROJ-298.md"
  }
}
```

The `workspace` and `changeset` fields are only present in workspace mode. In standalone mode, include a `screens` array listing the HTML files.

## Step 11: Apply Labels in Jira

**Skip entirely if `--dry-run` is in `$ARGUMENTS`.** Print `[DRY RUN] Skipping Jira label update for <RFE-KEY>`.

If not dry-run and the RFE was fetched from Jira (i.e., a real Jira key exists), add a provenance label to the RFE issue:

```bash
python3 -c "
import sys; sys.path.insert(0, 'scripts')
from jira_utils import add_labels, require_env
s, u, t = require_env()
add_labels(s, u, t, '<RFE-KEY>', ['prototype-creator-draft'])
"
```

Print `[LABEL] prototype-creator-draft added to <RFE-KEY>`.

If Jira credentials are unavailable and MCP is unavailable, skip this step silently — the label is provenance tracking, not blocking.

## Step 12: Summary and Next Steps

Print a summary of what was created:

**Workspace mode:**

```
Prototype created:

  RFE:        PROJ-298 — New Onboarding Wizard
  Workspace:  /path/to/rhoai (React + TypeScript + PatternFly 6)
  Fidelity:   medium (realistic)
  Mode:       decide (4 decisions surfaced, 2 auto-resolved)
  Files:      6 created, 2 modified
  Decisions:  .decisions/
  Changeset:  artifacts/changesets/PROJ-298.md
  Snapshot:   artifacts/prototype-originals/PROJ-298.md

Next steps:
  • Review the changes in the workspace
  • Run /prototype.review to score against the UX quality rubric
  • Run /prototype.refine to iterate based on review feedback
```

**Standalone mode:**

```
Prototype created:

  RFE:       PROJ-298 — New Onboarding Wizard
  Fidelity:  medium (realistic PatternFly)
  Mode:      decide (4 decisions surfaced, 2 auto-resolved)
  Screens:   4 files in artifacts/prototypes/PROJ-298/
  Decisions: .decisions/
  Snapshot:  artifacts/prototype-originals/PROJ-298.md

  Open in browser:
    open artifacts/prototypes/PROJ-298/index.html

Next steps:
  • Run /prototype.review to score the prototype against the UX quality rubric
  • Run /prototype.refine to iterate based on review feedback
  • Run /prototype.test-usability to simulate usability testing
```

If multiple RFEs were processed, print a summary table:

```
| RFE | Title | Workspace | Fidelity | Files | Status |
|-----|-------|-----------|----------|-------|--------|
| PROJ-298 | Onboarding Wizard | /path/to/rhoai | medium | 8 | ✓ created |
| PROJ-301 | Dashboard Redesign | (standalone) | medium | 3 | ✓ created |
```

## Edge Cases

### RFE has no user stories

If the RFE description contains requirements but no formal user stories, synthesize user stories from the requirements. Document this in `metadata.json` under `assumptions`. Proceed with prototype generation.

### RFE is too vague

If the RFE lacks enough detail to determine screen count, layout, or data model:
- In `auto` mode: Make reasonable assumptions based on the feature type. Document all assumptions.
- In `decide` mode: Ask the user to clarify before proceeding. Use `AskUserQuestion` to present what's missing and request guidance.

### RFE describes API-only changes

If the RFE is purely backend (API endpoints, data model changes, infrastructure) with no user-facing component:
- Print `[SKIP] <RFE-KEY> — RFE describes API/backend changes with no UI surface. Prototype creation is not applicable.`
- Write a note to `artifacts/prototype-originals/<RFE-KEY>.md` explaining why it was skipped.
- Do NOT generate a prototype.

### Multiple RFEs that compose a single feature

If the user provides multiple RFEs that clearly describe parts of the same feature (e.g., PROJ-298 is "Create pipeline" and PROJ-299 is "Monitor pipeline"), ask whether to:
1. Prototype each RFE independently (separate `artifacts/prototypes/<KEY>/` folders)
2. Combine into a single cohesive prototype (one folder, linked screens)

### Template not found (standalone mode only)

If `templates/layouts/` or `templates/components/` directories do not exist or contain no matching templates, generate all HTML from scratch using PatternFly documentation and conventions. Print `[INFO] No matching template found — generating from PatternFly conventions`.

### Workspace path does not exist

If `--workspace` points to a local path that doesn't exist, stop:

> Workspace path `<path>` does not exist. Provide a valid local path or a git URL to clone.

### Workspace is an unrecognized tech stack

If the workspace doesn't contain a recognizable project structure (no `package.json`, `pyproject.toml`, etc.), warn but proceed:

> `[WARN] Could not detect tech stack in <path>. Generating standalone HTML files in the workspace directory.`

### Workspace has uncommitted changes

Before writing to a workspace, check for uncommitted changes. If found, warn:

> `[WARN] Workspace has uncommitted changes. Proceeding — your existing changes will not be affected, but consider committing first.`

### Upstream decisions exist

If `.decisions/decisions.json` already exists (from a prior run or upstream thinking skill), read it. Do not re-ask questions already answered. Reference prior decisions in new decision options and recommendations.

### Jira MCP unavailable

If `mcp__atlassian__getJiraIssue` fails or is unavailable, fall back to:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/fetch_rfe.py <RFE-KEY> --fields summary,description,priority,labels,status --markdown
```

If the script also fails (no Jira credentials), ask the user to provide the RFE content directly or point to a local file.

$ARGUMENTS
