---
name: prototype-test-usability
description: Simulate a usability test — walks through the prototype as different user personas and identifies friction points, confusion, and missing interactions.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
---

# prototype-test-usability

Runs a simulated usability test on a prototype by walking through task scenarios as if specific personas were using it. Identifies friction points, confusion, missing affordances, and error recovery gaps. Produces a structured usability report.

## What This Does (Plain Language)

This skill pretends to be different types of users and walks through your prototype step by step, just like a real usability test session. It checks whether people can actually accomplish the tasks the feature is designed for.

It creates personas like:
- A **primary user** who uses this feature regularly
- A **power user** who wants efficiency and shortcuts
- An **infrequent user** who rarely touches this and needs clear guidance

Then it walks each persona through realistic tasks (e.g., "create a new item," "find and edit an existing entry") and notes where they'd get stuck, confused, or frustrated.

The output is a structured report with severity-ranked issues — from critical blockers ("the user literally can't complete the task") down to minor polish items.

**Good to know:** This is a simulated test, not real users. It catches design issues that are easy to miss, but it's not a replacement for actual user research. Think of it as a thorough self-review from multiple perspectives.

**When to use this:** After your prototype has been built and reviewed. It's most useful at medium or high fidelity — wireframes don't have enough detail for meaningful usability testing.

## Conversational Guidance

If the user asks about usability without an ID (e.g., "test whether this is easy to use" or "would a user be able to figure this out?"), check for the most recent prototype and offer:

> Want me to run a simulated usability test on your [RFE title] prototype? I'll walk through it as different types of users and flag anywhere they'd likely get stuck or confused.

## Invocation

```
/prototype.test-usability [ID]
```

**Examples:**

```bash
# Run usability test on prototype RFE-42
/prototype.test-usability RFE-42

# Test a prototype in the local workspace
/prototype.test-usability RFE-42 --local
```

## Inputs

| Input | Location | Required |
|-------|----------|----------|
| Prototype files | `.artifacts/{ID}/prototype/` | Yes |
| Research context | `.context/research-context/` | Optional |
| RFE source | `.artifacts/{ID}/rfe-snapshot.md` or Jira (via MCP) | Optional |

### Research Context

If `.context/research-context/` exists, read these files for grounding:

- `personas.md` or `personas.yaml` — user archetypes with goals, pain points, and tech comfort levels
- `jtbd.md` — Jobs To Be Done framework entries
- `top-tasks.md` — prioritized user task list

If no research context is available, construct 2–3 generic personas based on the prototype's domain:

1. **Primary user** — the person this feature is built for (moderate tech skill)
2. **Power user** — experienced, wants efficiency and keyboard shortcuts
3. **Infrequent user** — uses this rarely, needs clear wayfinding

## Step-by-Step Procedure

### Step 1: Read the Prototype

Locate and read the prototype from `.artifacts/{ID}/prototype/`.

Read all HTML files to understand:
- Available screens and views
- Navigation structure (how screens connect)
- Interactive elements (buttons, forms, links, menus)
- Data displayed and data entry points
- States shown (empty, loading, error, success)

If the prototype has a `metadata.json`, read it for context on intended scope and fidelity level.

### Step 2: Extract User Stories

Pull user stories from the RFE source:

1. Check `.artifacts/{ID}/rfe-snapshot.md` for locally cached RFE content
2. If not found, check the prototype's `metadata.json` for a Jira link
3. If a Jira issue key is available (e.g., `PROJ-298`), fetch it via MCP: `mcp__atlassian__getJiraIssue`

From the user stories, extract the core tasks users need to accomplish. Each user story maps to one or more task scenarios.

If no RFE is available, infer tasks from the prototype's UI (forms suggest data entry tasks, lists suggest browse/filter tasks, etc.).

### Step 3: Define Task Scenarios

For each extracted task, write a concrete scenario:

```markdown
**Task:** Create a new configuration entry
**Scenario:** You need to add a new database connection to the system. You know the hostname (db.example.com), port (5432), and credentials. Find where to do this and complete the setup.
**Persona:** Primary user (moderate tech skill)
**Success criteria:** Configuration is saved and visible in the list
```

Create 4–8 task scenarios covering:
- The primary happy path (most important user goal)
- A secondary workflow
- An error or edge case recovery
- A discovery/navigation task ("find X")

Distribute scenarios across personas so each persona walks through at least one task.

### Step 4: Walk Through Each Scenario

For each task scenario, simulate the persona's experience step by step:

1. **Entry point** — Where does the user start? Is it obvious how to begin this task?
2. **Navigation** — Can the user find the right screen? How many clicks/steps?
3. **Comprehension** — Are labels, icons, and layout understandable without explanation?
4. **Interaction** — Are form fields, buttons, and controls clear? Is the interaction model consistent?
5. **Feedback** — Does the system confirm actions? Are there loading indicators, success messages, error states?
6. **Recovery** — If the user makes a mistake, can they undo or correct it? Is the error message helpful?
7. **Completion** — Does the user know they've finished? Is there a clear success state?

For each step, note:
- **Predicted success** — Would this persona likely complete this step? (yes / with difficulty / unlikely / blocked)
- **Friction level** — none, low, medium, high
- **Issues found** — specific problems encountered

### Step 5: Identify Issues

Categorize all issues found across walkthroughs:

**Issue types:**
- **Task completion blocker** — user cannot complete the task at all (missing screen, broken flow)
- **Friction point** — user can complete but with unnecessary difficulty (buried controls, ambiguous labels)
- **Confusion point** — user may misinterpret what to do (unclear terminology, misleading layout)
- **Missing affordance** — a needed control or feedback mechanism doesn't exist (no undo, no confirmation)
- **Error recovery gap** — user makes a mistake and there's no way to recover or no helpful guidance

**Severity levels:**
- **Critical** (S1) — blocks task completion entirely
- **Major** (S2) — significantly impedes task completion or causes data loss risk
- **Minor** (S3) — causes momentary confusion or inefficiency
- **Enhancement** (S4) — opportunity to improve but not a problem per se

### Step 6: Apply Heuristic Evaluation

Beyond task walkthroughs, evaluate the prototype against standard usability heuristics:

1. **Visibility of system status** — does the user know what's happening?
2. **Match between system and real world** — does terminology match user expectations?
3. **User control and freedom** — can users undo, go back, escape?
4. **Consistency and standards** — are patterns consistent across screens?
5. **Error prevention** — does the design prevent mistakes before they happen?
6. **Recognition over recall** — are options visible rather than requiring memory?
7. **Flexibility and efficiency** — are there shortcuts for experienced users?
8. **Aesthetic and minimalist design** — is irrelevant information hidden?
9. **Help users recognize and recover from errors** — are error messages clear and actionable?
10. **Help and documentation** — is guidance available where needed?

Note which heuristics are violated and where.

### Step 7: Generate Usability Report

Write the report to `.artifacts/{ID}/usability-report.md`:

```markdown
---
prototype: {ID}
date: YYYY-MM-DD
personas-used: [Primary User, Power User, Infrequent User]
task-count: N
issue-count: N
critical-issues: N
---

# Usability Test Report: {ID}

## Summary

Brief 2–3 sentence overview of findings. State the overall usability
posture: is this prototype ready for user testing, or does it need
significant refinement first?

## Personas

| Persona | Description | Tech Comfort |
|---------|-------------|--------------|
| Primary User | [description] | Moderate |
| Power User | [description] | High |
| Infrequent User | [description] | Low |

## Task Scenarios

| # | Task | Persona | Predicted Success | Friction Level | Issues |
|---|------|---------|-------------------|----------------|--------|
| 1 | Create new config entry | Primary | With difficulty | Medium | 2 |
| 2 | Find and edit existing entry | Power | Yes | Low | 1 |
| 3 | Recover from validation error | Infrequent | Unlikely | High | 3 |
| 4 | Navigate to settings | Primary | Yes | None | 0 |

## Detailed Walkthrough Findings

### Task 1: Create new config entry (Primary User)

**Step 1: Entry point**
- The user lands on the dashboard. The "Add" button is in the toolbar
  but uses an icon-only pattern with no label.
- Friction: Medium — icon meaning is ambiguous without hover.

[...continue for each step...]

## Heuristic Walkthrough Findings

| Heuristic | Rating | Notes |
|-----------|--------|-------|
| Visibility of system status | Fair | No loading indicators on form submit |
| Match with real world | Good | Terminology matches domain conventions |
| User control and freedom | Poor | No undo after delete, no cancel on modal |
| ... | ... | ... |

## Issue List (Severity-Ranked)

### Critical (S1)

1. **No error state on form submission** — If the API call fails,
   the user sees no feedback. The form just sits there.
   - Screen: /config/new
   - Heuristic: #1 (Visibility of system status), #9 (Error recovery)

### Major (S2)

2. **Delete action has no confirmation** — Clicking delete immediately
   removes the item with no undo or confirmation dialog.
   - Screen: /config/list
   - Heuristic: #3 (User control), #5 (Error prevention)

### Minor (S3)

[...]

### Enhancements (S4)

[...]

## Recommendations

Prioritized list of changes for prototype refinement:

1. **Add error and loading states to all form submissions** (addresses S1-1)
2. **Add confirmation dialog for destructive actions** (addresses S2-2)
3. [...]

## Methodology Note

This is a simulated usability test using persona-based cognitive
walkthroughs and heuristic evaluation. It identifies likely usability
issues but does not replace testing with real users. Findings should
be treated as hypotheses to validate in actual usability sessions.
```

### Step 8: Report Completion

Print a summary:

```
Usability test complete: {ID}

Scenarios tested: 6
Issues found: 12 (2 critical, 4 major, 4 minor, 2 enhancements)

Top issues:
  [S1] No error state on form submission
  [S1] Navigation dead-end on detail page
  [S2] Delete action has no confirmation

Report: .artifacts/{ID}/usability-report.md

Next step: Address critical issues with /prototype.refine {ID}
```

## Edge Cases

- **Single-screen prototype**: Create scenarios focused on the interactions within that screen (form fill, filter, sort) rather than cross-screen navigation. Still evaluate all applicable heuristics.
- **Low-fidelity wireframe**: Reduce expectations for visual feedback states. Focus on information architecture and flow completeness. Note in the report that fidelity limits the depth of interaction testing.
- **No user stories available**: Derive tasks from the prototype's UI affordances. Document in the report that scenarios were inferred rather than sourced from requirements.
- **Prototype has only happy path**: Flag missing states (error, empty, loading) as completeness issues but still walk through the happy path for usability. Mark error recovery gaps as "untestable — state not implemented."
- **Many screens (10+)**: Prioritize the primary flow and 2–3 secondary paths. Don't attempt exhaustive coverage — note which areas were not tested and why.

## Output

| Output | Location |
|--------|----------|
| Usability report | `.artifacts/{ID}/usability-report.md` |
