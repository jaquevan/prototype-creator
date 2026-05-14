---
name: prototype-speedrun
description: End-to-end prototype pipeline — create, review, refine, and submit in one go. Guides the user conversationally through all options. Best starting point for designers who want a complete prototype from a Jira ticket.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
---

# prototype-speedrun

End-to-end orchestrator that runs the full prototype pipeline — create, review, optionally refine, and submit — in a single invocation. Designed for both CI batch runs and interactive single-prototype workflows.

## Conversational Onboarding

**When to use this section:** If `$ARGUMENTS` is empty, contains only an RFE ID with no flags, or the user's message is conversational (e.g., "run the full pipeline," "make me a prototype end to end," "let's prototype this"), guide them through the questions below before proceeding. This is the most common entry point for designers who want a prototype built from start to finish.

**Do NOT ask all questions at once.** Ask one at a time. Wait for the answer before asking the next. Skip questions whose answers are already clear from the user's message or `$ARGUMENTS`.

**Tone guidance:** Use plain, designer-friendly language. Avoid CLI terminology. Frame choices in terms of outcomes and tradeoffs.

### Start with context

Before jumping into questions, briefly explain what the speedrun does:

> The speedrun runs the full prototype pipeline for you: I'll create the prototype, score it against a UX quality rubric, refine it if the score is low, and then save the results. Think of it as a one-stop-shop — you give me the feature, and I'll handle the rest.
>
> Let me ask a few questions so I can set this up right for you.

### Question 1: What are we prototyping?

If no RFE ID or Jira URL is provided:

> What feature would you like to prototype? Share a Jira ticket URL, a ticket ID (like `PROJ-298`), or just describe the feature.

### Question 2: Building on an existing codebase?

If no `--workspace` is provided:

> Do you have an existing codebase or prototype repo I should build on top of?
>
> - **Yes** — Share the folder path or a git URL (like a GitLab branch link). I'll add the feature directly into your existing code.
> - **No** — I'll generate a standalone HTML prototype you can open in any browser.

### Question 3: How polished should it be?

If no `--fidelity` is provided:

> How polished should this prototype be?
>
> 1. **Quick sketch** — Wireframe-style, gray boxes, fast to generate. Good for early exploration. *(low fidelity)*
> 2. **Realistic mockup** *(recommended)* — Real design system components, sample data, interactive elements. Looks close to the real product. *(medium fidelity)*
> 3. **Fully detailed** — Every state covered (loading, errors, empty), production-ready polish. Takes the longest. *(high fidelity)*

### Question 4: Do you want to guide design decisions?

If no `--mode` is provided:

> As I build, I'll encounter design decisions (layout choices, component picks, flow structure). Want to weigh in?
>
> - **Yes, I want to decide** — I'll show you options with visual previews at each decision point. You pick the direction.
> - **No, handle it for me** — I'll make smart defaults based on best practices. You'll review the final result.

If they choose "decide," also ask about depth (same as prototype-create onboarding Question 5).

### Question 5: Where should the final result go?

If no `--target` is provided:

> Once the prototype is built and reviewed, where would you like it to end up?
>
> - **Just keep it local** *(default)* — Save everything here on your machine. You can share files manually or come back to refine later.
> - **Create a merge request** — I'll push the changes to the source repo as a merge request. Great when you want teammates to review.
>
> You can always change this later — we won't publish anything without your say-so.

Map "merge request" → `--target=repo`. Map "local" → `--target=local`.

### Question 6: Want me to run usability or desirability testing too?

Only ask if `--fidelity` is `medium` or `high` (testing isn't very useful on wireframes):

> After building and reviewing the prototype, I can also run simulated testing:
>
> - **Usability test** — I'll walk through the prototype as different types of users and identify friction points, confusing flows, and missing interactions.
> - **Desirability study** — I'll evaluate the emotional and aesthetic impact — does it feel professional? Modern? Trustworthy?
> - **Both**
> - **Skip testing** *(default)* — Just build, review, and optionally refine.
>
> These are simulated (not real users), but they catch issues that are easy to miss.

Map answers to `--test-usability`, `--test-desirability`, `--test-all`, or neither.

### After Onboarding: Confirm the plan

Print a plain-language summary:

> Here's the plan:
>
> - **Feature:** [RFE title]
> - **Building on:** [workspace or "standalone HTML"]
> - **Polish level:** [quick sketch / realistic mockup / fully detailed]
> - **Design decisions:** [you'll decide / auto-pilot]
> - **Output:** [local only / merge request to repo]
> - **Testing:** [usability / desirability / both / none]
>
> The full pipeline will: **create** the prototype → **review** it against a UX rubric → **refine** if needed → **save/publish** the result.
>
> Ready to go?

Wait for confirmation, then map all answers to flags internally and proceed to Step 0.

## Quick Reference — Happy Path

For the most common case (single ID, workspace, auto mode, local submit):

```
1. Write config → .artifacts/<RFE-KEY>/pipeline-config.yaml
2. Fetch RFE from Jira (parallel with clone)
3. Clone workspace (parallel with Jira fetch)
4. Analyze codebase INLINE — READ AGENTS.md and extract verification commands
5. Auto-resolve decisions → .artifacts/<RFE-KEY>/decisions/decisions.json (skip HTML pages if low fidelity)
6. Generate code changes in workspace
7. Lint + build verification (from target repo's AGENTS.md — mandatory, do not skip)
8. Review → if score >= 6 with no zeros → skip refine
9. Submit (--target=local is just record-keeping)
10. Print summary
```

For `--target=repo` with a workspace: the submit step automatically creates a GitLab merge request targeting the original workspace branch with a designer-oriented description that includes the feature summary, key design decisions, pipeline details (fidelity, mode, rubric score), and instructions for reviewing locally. No extra setup needed — uses GitLab push options with the user's existing git authentication.

### Sandbox and Git Permissions

Git operations (clone in Step 3, push in Step 8) write to `.git/` internals and contact remote servers. **These commands require elevated permissions** — specifically `required_permissions: ["all"]` in Cursor's Shell tool. The default sandbox blocks `.git/hooks/` writes and may block network access to internal git hosts. Always run `resolve_workspace.py` and `submit_to_repo.py` with `required_permissions: ["all"]`.

The `submit_to_repo.py` script automatically detects shallow clones (created by `resolve_workspace.py`'s `--depth 1`) and runs `git fetch --unshallow` before pushing, since GitLab rejects pushes from shallow repositories.

For the full spec including batch mode, edge cases, and extended testing, read on.

## Invocation

```
/prototype.speedrun [ID|--input batch.yaml] [flags]
```

**Examples:**

```bash
# Full pipeline for a single RFE with defaults (low fidelity, auto, local submit)
/prototype.speedrun PROJ-298

# Medium fidelity with human-in-the-loop decisions, targeting an existing repo
/prototype.speedrun PROJ-298 --fidelity=medium --mode=decide --workspace=/path/to/rhoai

# CI batch run: process multiple RFEs from a YAML file
/prototype.speedrun --input batch.yaml --headless --announce-complete

# Full pipeline, publish to Apollo, dry-run first
/prototype.speedrun PROJ-298 --target=apollo --dry-run

# High fidelity with thorough decisions, publish to git repo
/prototype.speedrun PROJ-298 --fidelity=high --depth=over --target=repo --remote=git@gitlab.example.com:team/prototypes.git

# Quick pass: only surface the 2-3 biggest decisions
/prototype.speedrun PROJ-298 --depth=under --mode=decide --workspace=/path/to/prototype
```

## Defaults

When no flags are provided, the speedrun uses these defaults:

| Flag | Default | Rationale |
|------|---------|-----------|
| `--workspace` | none | No target codebase; generates standalone HTML |
| `--branch` | none | Uses default branch or branch detected from workspace URL |
| `--fidelity` | `low` | Fast iteration; wireframe-level output |
| `--mode` | `auto` | AI makes all design decisions |
| `--depth` | `normal` | 4–7 context-dependent decisions |
| `--target` | `local` | No external publishing; safe default |
| `--dry-run` | Off | Actually write outputs |
| `--headless` | Off | Allow interactive prompts |
| `--max-refine-cycles` | 3 | Cap auto-refinement iterations |

## Pipeline Sequence

```
1. CREATE   → prototype-create --fidelity={fidelity} --mode={mode} --depth={depth} [--workspace={workspace}]
               (includes lint + build verification from target repo's AGENTS.md — Step 11 in create skill)
2. REVIEW   → prototype-review
3. REFINE?  → prototype-refine (only if review scores need attention)
4. SUBMIT   → prototype-submit --target={target}
```

Refinement (step 3) is conditional:
- **Triggered** when the review total score is < 6 or any dimension scores 0
- **Skipped** when the review scores pass (total ≥ 6, no zeros)
- After refinement, re-review automatically before proceeding to submit

Optional extended testing steps can be added with flags:
- `--test-usability` — run `prototype-test-usability` after review
- `--test-desirability` — run `prototype-test-desirability` after review
- `--test-all` — run both usability and desirability tests

Extended pipeline with all tests:

```
1. CREATE   → prototype-create
2. REVIEW   → prototype-review
3. REFINE?  → prototype-refine (if needed)
4. TEST-U   → prototype-test-usability (if --test-usability or --test-all)
5. TEST-D   → prototype-test-desirability (if --test-usability or --test-all)
6. SUBMIT   → prototype-submit
```

## Step-by-Step Procedure

### Step 0: Parse and Persist Flags

Parse all provided flags into a config object. Write to `.artifacts/<RFE-KEY>/pipeline-config.yaml` for context compression survival. For batch mode (multiple IDs), use the first ID for the path and list all IDs in `input.ids`:

```yaml
# .artifacts/<RFE-KEY>/pipeline-config.yaml
# Auto-generated by prototype-speedrun — do not edit manually
parsed: 2026-04-30T12:00:00Z
input:
  ids: [PROJ-298]
  batch-file: null
flags:
  workspace: null
  branch: null
  fidelity: low
  mode: auto
  depth: normal
  target: local
  dry-run: false
  headless: false
  max-refine-cycles: 3
  test-usability: false
  test-desirability: false
  remote: null
  announce-complete: false
```

This file is the source of truth if the conversation context is compressed mid-run. Always check for it at the start of each step. It lives inside `.artifacts/` so it is gitignored alongside all other pipeline output.

### Step 1: Determine Input IDs

**Single ID mode:** Use the provided RFE ID directly.

**Batch mode (`--input batch.yaml`):** Read the batch file:

```yaml
# batch.yaml
prototypes:
  - id: PROJ-298
    fidelity: medium    # per-item override
  - id: PROJ-301
  - id: PROJ-305
    mode: decide        # per-item override
```

Per-item overrides take precedence over global flags. Items without overrides inherit the global defaults.

### Step 2: Run Pipeline for Each ID

Process each ID sequentially (or report the plan for batch).

For each prototype ID:

#### 2a. CREATE

Invoke the `prototype-create` skill:

```
/prototype.create {ID} --fidelity={fidelity} --mode={mode} --depth={depth} [--workspace={workspace}]
```

If creation fails, log the error and skip to the next ID (in batch mode) or stop (in single mode).

Verify output exists:
- **Workspace mode**: Check `.artifacts/{ID}/changeset.md` and that workspace files were written
- **Standalone mode**: Check `.artifacts/{ID}/prototype/index.html`

**Important — workspace mode verification:** The `prototype-create` skill includes a mandatory Step 11 (post-change verification) that runs lint and build commands from the target repo's `AGENTS.md`. This step must complete successfully before proceeding to review. If it was skipped during create (e.g., due to context compression), run it now:

```bash
cd <workspace-path>
npm install    # if node_modules/ missing
npx eslint <changed-files> --no-warn
npm run build
```

Fix any errors before proceeding — the target repo's CI pipeline will reject the MR otherwise.

#### 2b. REVIEW

Invoke the `prototype-review` skill:

```
/prototype.review {ID}
```

Read the review scores from `.artifacts/{ID}/reviews/summary.md`.

Record: total score, per-dimension scores, pass/fail.

#### 2c. REFINE (conditional)

Check review scores:
- If total ≥ 6 **and** no dimension scores 0 → **skip refinement**, proceed to submit
- Otherwise → **run refinement**

If refinement is triggered:

```
/prototype.refine {ID} --mode={mode} --headless={headless} --max-cycles={max-refine-cycles}
```

The refine skill handles its own review-refine loop internally (up to `max-refine-cycles`).

After refinement completes, record the final review scores.

#### 2d. TEST (optional)

If `--test-usability` or `--test-all`:

```
/prototype.test-usability {ID}
```

If `--test-desirability` or `--test-all`:

```
/prototype.test-desirability {ID}
```

Testing does not gate submission — results are informational.

#### 2e. SUBMIT

Invoke the `prototype-submit` skill:

```
/prototype.submit {ID} --target={target} [--remote={remote}] [--dry-run]
```

Record: submission target, label applied, success/failure.

### Step 3: Generate Summary

After all IDs are processed, print a pipeline summary:

**Single prototype:**

```
Pipeline complete: PROJ-298

  Step      Status    Details
  ────      ──────    ───────
  Create    Done      low fidelity, auto mode
  Review    Done      Score: 7/10 (pass)
  Refine    Skipped   Score passed threshold
  Submit    Done      Target: local

Label: prototype-creator-rubric-pass
Total time: ~2 minutes
```

**Batch run:**

```
Pipeline complete: 3 prototypes processed

  ID        Create  Review  Refine  Submit  Score  Label
  ──        ──────  ──────  ──────  ──────  ─────  ─────
  PROJ-298  ✓       ✓       skip    ✓       7/10   rubric-pass
  PROJ-301  ✓       ✓       ✓ (2x)  ✓       6/10   rubric-pass
  PROJ-305  ✓       ✓       ✓ (3x)  ✓       4/10   needs-attention

Summary:
  Passed: 2 / 3
  Need attention: 1 (PROJ-305)
  Total refinement cycles: 5
```

### Step 4: Announce Completion (if flagged)

If `--announce-complete` is set (CI mode), write a completion signal:

```bash
# Write CI signal file
echo '{"status":"complete","processed":3,"passed":2,"failed":1}' > .artifacts/pipeline-complete.json
```

This file can be polled by CI systems to detect pipeline completion.

## Flag Reference

| Flag | Values | Default | Source Skill |
|------|--------|---------|-------------|
| `--workspace` | Local path or git URL | None | prototype-create |
| `--branch` | Branch name | None | prototype-create |
| `--fidelity` | `low`, `medium`, `high` | `low` | prototype-create |
| `--mode` | `auto`, `decide` | `auto` | prototype-create, prototype-refine |
| `--depth` | `under`, `normal`, `over` | `normal` | prototype-create |
| `--target` | `apollo`, `repo`, `local` | `local` | prototype-submit |
| `--remote` | Git URL | None | prototype-submit |
| `--dry-run` | (flag) | Off | prototype-submit |
| `--headless` | (flag) | Off | prototype-refine |
| `--max-refine-cycles` | Integer | `3` | prototype-refine |
| `--test-usability` | (flag) | Off | prototype-test-usability |
| `--test-desirability` | (flag) | Off | prototype-test-desirability |
| `--test-all` | (flag) | Off | Both test skills |
| `--input` | YAML file path | None | Batch mode |
| `--announce-complete` | (flag) | Off | CI signal |
| `--skip-jira` | (flag) | Off | prototype-submit |
| `--force` | (flag) | Off | prototype-submit |
| `--no-ssl-verify` | (flag) | Off | prototype-create (clone), prototype-submit (push) |

## Batch File Format

```yaml
# batch.yaml
defaults:
  fidelity: low
  mode: auto
  depth: normal
  target: local
  workspace: null

prototypes:
  - id: PROJ-298
    workspace: /path/to/rhoai
  - id: PROJ-301
    fidelity: medium
  - id: PROJ-305
    mode: decide
    target: apollo
```

The `defaults` section sets baseline values. Per-prototype overrides take precedence. Command-line flags override both.

**Precedence order:** CLI flags > per-prototype overrides > batch defaults > speedrun defaults

## Context Compression Survival

Long-running pipelines (especially batch or high-fidelity) may exceed context windows. The speedrun uses two mechanisms to survive:

1. **Flag persistence** — `.artifacts/<RFE-KEY>/pipeline-config.yaml` stores all parsed flags. If context is compressed, re-read this file to recover configuration.

2. **Progress tracking** — After each pipeline step, update `.artifacts/<RFE-KEY>/pipeline-progress.yaml`:

```yaml
# .artifacts/<RFE-KEY>/pipeline-progress.yaml
prototypes:
  PROJ-298:
    create: done
    review: done
    refine: skipped
    submit: done
    score: 7
    label: rubric-pass
  PROJ-301:
    create: done
    review: done
    refine: in-progress (cycle 2 of 3)
    submit: pending
    score: 4
```

Both files live inside `.artifacts/` (gitignored) alongside the prototype output. No files are written to a shared `tmp/` directory.

If the agent resumes after compression, it reads progress and skips completed steps.

## Edge Cases

- **RFE not found in Jira**: The `prototype-create` skill handles this — speedrun should surface its error message and stop processing that ID. In batch mode, skip to the next ID.

- **All prototypes fail review**: Report the summary with all items as `needs-attention`. Don't retry beyond `max-refine-cycles`. The summary should clearly indicate that human review is needed.

- **Batch file doesn't exist**: Stop immediately:
  > Batch file `{path}` not found. Provide a valid YAML file or use a single RFE ID instead.

- **Partial batch failure**: Process all IDs even if some fail. Report successes and failures in the summary. Don't let one failure stop the entire batch.

- **Context window near limit**: If processing a large batch, check `.artifacts/<RFE-KEY>/pipeline-progress.yaml` after each ID. If the context feels constrained, write progress and suggest the user re-invoke with the same `--input` file (already-completed items will be skipped).

- **Conflicting flags**: If `--mode=decide` is combined with `--headless`, warn:
  > `--mode=decide` requires human input for design decisions, but `--headless` skips all prompts. Falling back to `--mode=auto` for this run.

- **Dry-run with testing**: `--dry-run` only affects the submit step. Create, review, refine, and test steps still execute and produce artifacts. Only external writes (Apollo API, git push, Jira updates) are skipped.

## Output

| Output | Location |
|--------|----------|
| Prototypes (standalone) | `.artifacts/{ID}/prototype/` |
| Workspace changes | Target workspace directory (when `--workspace` is set) |
| Changesets | `.artifacts/{ID}/changeset.md` (workspace mode) |
| Workspace analysis | `.artifacts/{ID}/workspace-analysis.json` (workspace mode) |
| Decisions | `.artifacts/{ID}/decisions/` |
| Reviews | `.artifacts/{ID}/reviews/summary.md` |
| Usability reports (if tested) | `.artifacts/{ID}/usability-report.md` |
| Desirability reports (if tested) | `.artifacts/{ID}/desirability-report.md` |
| Submission manifest | `.artifacts/submissions.md` |
| Pipeline config | `.artifacts/{ID}/pipeline-config.yaml` |
| Pipeline progress | `.artifacts/{ID}/pipeline-progress.yaml` |
| CI completion signal | `.artifacts/pipeline-complete.json` (if `--announce-complete`) |
