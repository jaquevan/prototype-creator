---
name: prototype-refine
description: Improve a prototype based on review feedback or your own direction. Fixes usability issues, fills gaps, and adjusts polish level.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
---

# prototype-refine

Refines an existing prototype by addressing review feedback, user-provided direction, or decision-kit outcomes. Each refinement cycle targets specific issues flagged in the review and tracks what changed.

## What This Does (Plain Language)

After a prototype has been reviewed (or after you've looked at it yourself), this skill makes targeted improvements. Think of it as a revision pass — it reads the review feedback, figures out what needs fixing, and updates the prototype.

Common things it fixes:
- Missing screens or flows that the review flagged
- Usability issues like confusing labels or dead-end navigation
- Swapping in correct design system components
- Adjusting the level of polish up or down

**You can also give it your own direction** — if you looked at the prototype and want specific changes (e.g., "make the table less dense" or "add an empty state"), just say so. It doesn't have to work from a review score.

## Conversational Guidance

If the user asks to refine without specifying details (e.g., "can you improve this?" or "it needs some work"), ask:

> I can refine the prototype based on review feedback, or based on your own direction. Which would you prefer?
>
> - **Use the review feedback** — I'll read the quality review and fix the issues it flagged, starting with the most critical ones.
> - **I'll tell you what to change** — Just describe what you'd like different and I'll make those specific changes.
> - **Both** — I'll address review issues and incorporate your feedback too.

If no review exists and the user hasn't provided direction, explain:

> I don't have a review on file for this prototype yet. I can either run a quick review first to identify what needs work, or you can tell me directly what to change. What works best?

## Invocation

```
/prototype.refine [ID] [--mode=auto|decide] [--headless] [--max-cycles=N]
```

**Examples:**

```bash
# Refine the prototype for RFE-42, addressing review feedback interactively
/prototype.refine RFE-42

# Auto-refine in CI (no prompts, max 3 cycles)
/prototype.refine RFE-42 --mode=auto --headless

# Surface each refinement decision as a decision-kit artifact
/prototype.refine RFE-42 --mode=decide

# Limit to a single refinement pass
/prototype.refine RFE-42 --max-cycles=1
```

## Inputs

| Input | Location | Required |
|-------|----------|----------|
| Prototype files | Target workspace or `.artifacts/{ID}/prototype/` | Yes |
| Workspace analysis | `.artifacts/{ID}/workspace-analysis.json` | Yes (workspace mode) |
| Decisions | `.artifacts/{ID}/decisions/decisions.json` | Recommended |
| Review summary | `.artifacts/{ID}/reviews/summary.md` | Yes (for auto mode) |
| User direction | Interactive prompt or `--headless` flags | Optional |
| Research context | `.context/research-context/` (personas, JTBD) | Optional |

## Step-by-Step Procedure

### Step 1: Locate the Prototype

Search for the prototype in `.artifacts/{ID}/`:

1. **Workspace mode** — Check `.artifacts/{ID}/workspace-analysis.json` for a workspace path. If found, the prototype lives in the target workspace. Read the changeset at `.artifacts/{ID}/changeset.md` to find which files belong to this prototype.
2. **Standalone mode** — Check `.artifacts/{ID}/prototype/` for HTML files.

If `.artifacts/{ID}/` does not exist, stop and report:

> Prototype `{ID}` not found. Run `prototype.create` first.

**Workspace mode**: Read the files listed in the changeset manifest. Also read `.artifacts/{ID}/decisions/decisions.json` and `.artifacts/{ID}/decisions/strategy-brief.md` to understand the design decisions that informed the prototype.

**Standalone mode**: Read the prototype's `index.html` and any associated files from `.artifacts/{ID}/prototype/`.

### Step 2: Read Review Feedback

Read the review summary from `.artifacts/{ID}/reviews/summary.md`.

Extract the structured feedback sections:

- **Completeness gaps** — missing screens, flows, or states
- **Usability issues** — confusing interactions, missing affordances, unclear navigation
- **Feasibility concerns** — components that don't exist in the design system, patterns that break conventions
- **Fidelity mismatches** — prototype fidelity doesn't match the requested level
- **Rubric scores** — per-dimension scores (completeness, usability, feasibility, fidelity, overall)

If no review summary exists and `--mode=auto`:

> No review feedback found at `.artifacts/{ID}/reviews/summary.md`. Cannot auto-refine without review input. Run `prototype.review` first or provide direction interactively.

If no review summary exists and mode is interactive, ask the user what to refine.

### Step 3: Check Iteration Count

Read the prototype's `metadata.json` frontmatter. Look for:

```json
{
  "refinement": {
    "iteration": 0,
    "history": []
  }
}
```

If `iteration >= 3` (or `--max-cycles` value), stop and report:

> Prototype `{ID}` has been refined {N} times. Stopping for human review. Use `--max-cycles=N` to override or provide manual direction.

If `--headless` is set and the limit is reached, exit cleanly without prompting.

### Step 4: Plan Refinements

For each issue category from the review, create a refinement plan:

**Completeness gaps:**
- Identify which screens, flows, or states are missing
- Determine minimal additions to address each gap
- Prioritize by severity (issues scored 0 in rubric come first)

**Usability issues:**
- Map each issue to a specific element or interaction in the prototype
- Determine the fix (add label, restructure layout, add feedback state, etc.)

**Feasibility concerns:**
- Replace non-standard components with PatternFly equivalents
- Check `.context/design-system/` for correct component usage

**Fidelity mismatches:**
- If fidelity is too low: add real labels, realistic data, proper spacing
- If fidelity is too high for the requested level: simplify

### Step 5: Handle Decision Mode

If `--mode=decide`:

For each non-trivial refinement (where multiple valid approaches exist), produce a decision-kit artifact:

1. Write the decision page to `.artifacts/{ID}/decisions/decision-NNN-refine-slug.html`
2. Include:
   - The current state (code snippet or description)
   - 4 refinement options with visual previews
   - Tradeoffs and comparison table for each option
   - A recommendation with reasoning
3. Record the decision in `.artifacts/{ID}/decisions/decisions.json`
4. Ask the user to pick

If `--mode=auto`, pick the recommended option and proceed. Record auto-picked refinement decisions in `.artifacts/{ID}/decisions/decisions.json` with `status: "auto-picked"`.

### Step 6: Apply Refinements

Edit the prototype files to address each planned refinement.

**Workspace mode**: Edit files in the target workspace using the codebase's conventions (from `.artifacts/{ID}/workspace-analysis.json`). Follow the same patterns used in the original creation — same component style, same file structure, same import conventions.

**Standalone mode**: Modify `index.html` and screen-specific HTML files. Replace incorrect components with proper design system markup. Add missing states.

In both modes: preserve the prototype's existing structure and conventions. Do not rewrite from scratch — make targeted edits.

### Step 7: Update Metadata

Update the prototype's `metadata.json` to track the refinement:

```json
{
  "refinement": {
    "iteration": 1,
    "history": [
      {
        "iteration": 1,
        "date": "2026-04-30",
        "mode": "auto",
        "changes": [
          "Added missing error state to form submission flow",
          "Replaced custom modal with PatternFly Modal component",
          "Added breadcrumb navigation to detail view"
        ],
        "reviewSource": ".artifacts/RFE-42/reviews/summary.md"
      }
    ]
  }
}
```

### Step 8: Write Updated Prototype

Write all modified files back to the **same location** the prototype was read from (local/ or artifacts/).

### Step 9: Report

Print a refinement summary:

```
Prototype refined: {ID} (iteration {N})

Changes applied:
  - [completeness] Added error state to form flow
  - [usability] Replaced ambiguous icon with labeled button
  - [feasibility] Swapped custom dropdown for PatternFly Select

Review scores addressed:
  - Completeness: 1 → (pending re-review)
  - Usability: 1 → (pending re-review)

Next step: Run /prototype.review {ID} to re-score.
```

If `--headless` and the iteration limit hasn't been reached, automatically invoke `prototype.review` and loop back to Step 2 (auto-refinement cycle).

## Auto-Refinement Loop (Headless)

In `--headless --mode=auto`, the skill runs a tight loop:

```
refine → review → check scores → refine again (if needed) → review → ...
```

Exit conditions:
1. All rubric scores are ≥ 2 and total is ≥ 6 → exit with `rubric-pass`
2. Iteration count reaches `--max-cycles` (default 3) → exit with `needs-human-review`
3. No meaningful changes can be made (refinement plan is empty) → exit with `plateau-reached`

## Edge Cases

- **Prototype has no metadata.json**: Create one with `iteration: 0` before proceeding.
- **Review references screens that don't exist**: Skip those issues and note them in the summary as unaddressable.
- **Conflicting feedback**: If the review flags contradictory issues (e.g., "too simple" and "too complex"), prefer the direction that matches the requested fidelity level. In decide mode, surface this as a decision.
- **Large prototypes (many files)**: Process one screen/flow at a time. Don't attempt to refine everything in a single pass.
- **No .context/ available**: Proceed without design system validation. Note in the summary that feasibility checks were skipped.

## Output

| Output | Location |
|--------|----------|
| Updated prototype | Same as input (workspace or `.artifacts/{ID}/prototype/`) |
| Updated changeset | `.artifacts/{ID}/changeset.md` (workspace mode — updated with new/modified files) |
| Decision artifacts (decide mode) | `.artifacts/{ID}/decisions/decision-NNN-refine-slug.html` |
| Refinement log | Embedded in prototype's `metadata.json` |
