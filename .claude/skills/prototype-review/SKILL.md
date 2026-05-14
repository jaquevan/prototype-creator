---
name: prototype-review
description: Score a prototype against a UX quality rubric (completeness, usability, feasibility, fidelity). Just point it at a prototype — no special options needed.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
---

# prototype-review

Review and score a prototype against the UX quality rubric. Runs four independent review dimensions, each scored 0–2, then produces a summary with a pass/needs-attention verdict.

## What This Does (Plain Language)

This skill scores your prototype like a design review. It checks four things:

1. **Completeness** — Does the prototype cover everything the feature request describes? Missing screens or flows get flagged.
2. **Usability** — Is it easy to use? Clear navigation, good labels, helpful feedback when things go wrong?
3. **Feasibility** — Can this actually be built with the design system? Or does it rely on components that don't exist yet?
4. **Fidelity match** — Does the level of polish match what was requested? (A quick sketch shouldn't look production-ready, and vice versa.)

Each dimension gets a score of 0–2. You need at least 6 out of 8 total (with no zeros) to pass. If the score is lower, the review tells you exactly what to fix.

**You don't need to provide any special options** — just point it at a prototype ID and it does the rest. If you've just finished building a prototype, I'll suggest running this automatically.

## Conversational Guidance

If the user asks to review a prototype without providing an ID (e.g., "how did the prototype turn out?" or "review what we just built"), check `.artifacts/` for the most recently created prototype and offer to review it:

> I found a prototype for [RFE title] in your artifacts. Want me to run a quality review on it? I'll check completeness, usability, feasibility, and whether the polish level matches what you asked for.

## When to Use

- After `prototype.create` finishes and you need a quality gate
- After `prototype.refine` to re-score an updated prototype
- In CI mode to batch-score all unreviewed prototypes
- When a human asks `/prototype.review` or `/prototype.review {ID}`

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| Prototype ID | `$ARGUMENTS` or auto-detected from `.artifacts/` | Yes (or scan all) |
| Prototype files | `.artifacts/{ID}/prototype/` or target workspace (workspace mode) | Yes |
| Original RFE snapshot | `.artifacts/{ID}/rfe-snapshot.md` | Yes |

## Step 0: Detect Mode and Resolve Paths

All artifacts live in `.artifacts/{ID}/`. Determine whether the prototype is in **CI mode** or **local mode** by reading `.artifacts/{ID}/metadata.json` and checking the `mode` field (`"ci"` or `"local"`). When in local mode, skip Jira label updates and pipeline label gates.

If `$ARGUMENTS` contains a prototype ID, review only that prototype. Otherwise, scan `.artifacts/` for all RFE directories that do not yet have a `reviews/summary.md` and review each.

## Step 1: Load the Prototype and RFE

For each prototype ID to review:

**Determine if this is a workspace-mode or standalone-mode prototype:**

- If `.artifacts/{ID}/workspace-analysis.json` exists → **workspace mode**
- Otherwise → **standalone mode**

### Standalone Mode

1. **Read the prototype directory** at `.artifacts/{ID}/prototype/`:
   - `index.html` — the rendered prototype
   - Any additional pages or assets

2. **Read the original RFE snapshot** at `.artifacts/{ID}/rfe-snapshot.md`

3. **Read the metadata** at `.artifacts/{ID}/metadata.json` to determine the requested fidelity level (`low`, `medium`, or `high`).

### Workspace Mode

1. **Read the changeset manifest** at `.artifacts/{ID}/changeset.md`:
   - Lists all files created and modified in the target workspace
   - This is the "prototype" — the set of code changes

2. **Read the workspace analysis** at `.artifacts/{ID}/workspace-analysis.json`:
   - Contains the workspace path, tech stack, and relevant areas

3. **Read the modified/created files** listed in the changeset:
   - These are the actual prototype implementation files
   - Read each file to evaluate completeness, usability, feasibility, and fidelity

4. **Read the original RFE snapshot** at `.artifacts/{ID}/rfe-snapshot.md`

5. **Read the metadata** at `.artifacts/{ID}/metadata.json` to determine the requested fidelity level.

If either the prototype (directory or changeset) or the RFE snapshot is missing, report an error and skip this prototype.

## Step 2: Run Four Independent Review Dimensions

Each dimension is scored by a **prototype-scorer agent** — a restricted agent with Read, Write, Glob, and Grep tools only. Run each review independently; do not let one dimension's findings influence another.

For each dimension, invoke the scorer:

```
Agent: prototype-scorer (see .claude/agents/prototype-scorer.md)
Tools: Read, Write, Glob, Grep
Input: prototype files + RFE snapshot + dimension-specific rubric (below)
Output: .artifacts/{ID}/reviews/{dimension}.md
```

---

### Dimension 1: Completeness

**Question**: Does the prototype cover the RFE's user stories and acceptance criteria?

**Rubric**:

| Score | Criteria |
|-------|----------|
| **2 — Pass** | All user stories from the RFE are represented in the prototype. Every acceptance criterion has a corresponding screen, flow, or interaction. No significant gaps. |
| **1 — Partial** | Most user stories are covered (≥70%), but some acceptance criteria are missing or only partially represented. Minor gaps that could be filled in a refinement pass. |
| **0 — Fail** | Fewer than 70% of user stories are represented, or critical acceptance criteria are entirely absent. The prototype does not adequately cover the RFE scope. |

**Reviewer instructions**:
1. Extract every user story and acceptance criterion from the RFE snapshot
2. For each, determine whether the prototype addresses it (fully, partially, or not at all)
3. List covered items, partially covered items, and missing items
4. Note any prototype content that goes beyond the RFE (scope creep) — this is informational, not penalized
5. Assign score based on the rubric above

**Output file**: `.artifacts/{ID}/reviews/completeness.md`

---

### Dimension 2: Usability

**Question**: Does the prototype follow established usability heuristics and minimize user friction?

**Rubric**:

| Score | Criteria |
|-------|----------|
| **2 — Pass** | No major heuristic violations. Interaction patterns are clear and consistent. Error states, empty states, and loading states are handled (at the prototype's fidelity level). Navigation is intuitive. |
| **1 — Partial** | Minor heuristic violations (e.g., inconsistent terminology, missing feedback for one action, one unclear navigation path). Core flows are usable but have friction points. |
| **0 — Fail** | Major heuristic violations (e.g., dead-end flows, no error handling, confusing navigation, inconsistent interaction patterns). Users would likely get stuck. |

**Reviewer instructions** — evaluate against Nielsen's 10 usability heuristics:
1. **Visibility of system status** — Does the prototype show what's happening? Loading, progress, confirmations?
2. **Match between system and real world** — Natural language? Familiar concepts? Logical information order?
3. **User control and freedom** — Can users undo, go back, escape? Emergency exits present?
4. **Consistency and standards** — Same terms, actions, situations mean the same thing throughout?
5. **Error prevention** — Does the design prevent errors before they happen? Confirmations for destructive actions?
6. **Recognition rather than recall** — Are options visible? Can users recognize rather than remember?
7. **Flexibility and efficiency of use** — Shortcuts for expert users? Accelerators?
8. **Aesthetic and minimalist design** — Only relevant information shown? No visual clutter?
9. **Help users recognize, diagnose, and recover from errors** — Clear error messages? Suggest solutions?
10. **Help and documentation** — Contextual help where needed?

For each heuristic, note whether it is satisfied, partially satisfied, or violated, with specific examples from the prototype. Assign the overall dimension score based on the aggregate finding.

**Output file**: `.artifacts/{ID}/reviews/usability.md`

---

### Dimension 3: Feasibility

**Question**: Can this prototype be built with the available design system and technology?

**Rubric**:

| Score | Criteria |
|-------|----------|
| **2 — Pass** | All UI elements map to existing PatternFly 6 components or straightforward compositions of them. No custom components required beyond standard CSS. Layout patterns are standard (page sections, cards, tables, modals, drawers). |
| **1 — Partial** | Most elements map to PatternFly 6, but 1–2 components would require custom implementation or significant PatternFly extension. The custom work is well-scoped and achievable. |
| **0 — Fail** | Multiple UI elements have no PatternFly equivalent. The prototype relies on interaction patterns that would require significant custom engineering (e.g., drag-and-drop canvas, real-time collaboration, complex data visualization). Implementation risk is high. |

**Reviewer instructions**:
1. Inventory every distinct UI component used in the prototype
2. For each, identify the corresponding PatternFly 6 component (or note its absence)
3. Flag any layout patterns that don't map to standard PatternFly page structures
4. Note any interactions that would require custom JavaScript beyond PatternFly's built-in behavior
5. Estimate the ratio of standard-component vs. custom-component work
6. Assign score based on the rubric above

**Output file**: `.artifacts/{ID}/reviews/feasibility.md`

---

### Dimension 4: Fidelity Match

**Question**: Does the prototype match the requested fidelity level?

**Rubric** (varies by requested fidelity):

#### If requested fidelity = `low`

| Score | Criteria |
|-------|----------|
| **2 — Pass** | Wireframe aesthetic. Placeholder boxes, grayscale or minimal color, simple typography. Focus on layout and flow, not visual polish. Content is representative but clearly placeholder. |
| **1 — Partial** | Mostly wireframe, but includes some high-fidelity elements (polished icons, real images, styled components) that set unrealistic expectations. Or, too sparse — missing enough structure to understand the flow. |
| **0 — Fail** | Either over-designed (looks like a finished product, defeating the purpose of low-fidelity) or under-designed (just text descriptions, not a visual prototype). |

#### If requested fidelity = `medium`

| Score | Criteria |
|-------|----------|
| **2 — Pass** | Uses real design system components with realistic (but not necessarily final) content. Key flows are interactive or clearly annotated. Visual hierarchy is clear. Looks like a realistic application, not a wireframe. |
| **1 — Partial** | Mix of wireframe and realistic elements. Some flows use real components while others are still placeholder. Inconsistent fidelity across screens. |
| **0 — Fail** | Looks like a wireframe (too low) or is pixel-perfect with final copy and all edge cases (too high for medium). Doesn't match what medium fidelity should communicate. |

#### If requested fidelity = `high`

| Score | Criteria |
|-------|----------|
| **2 — Pass** | Production-ready fidelity. All design system components correctly applied. Real or realistic content. All states covered (empty, loading, error, populated, edge cases). Responsive considerations noted. Pixel-perfect spacing and typography. |
| **1 — Partial** | High-fidelity for main flows, but missing states, edge cases, or responsive considerations. Most components are correct but some have wrong variants or missing properties. |
| **0 — Fail** | Does not reach high fidelity — missing too many states, using placeholder content throughout, or has significant visual inconsistencies with the design system. |

**Workspace mode note**: In workspace mode, fidelity is controlled by a URL parameter (`?fidelity=low`) on the prototype link, not by the code structure. The prototype code always uses real design system components (because the target codebase requires it). The fidelity level controls what the user *sees* when they open the prototype link — low shows wireframe rendering, medium shows realistic components, high shows production-ready polish. When reviewing workspace-mode prototypes for fidelity match, evaluate based on whether the appropriate fidelity parameter is set and whether the code supports the requested fidelity's scope (e.g., low = core flow only, high = all states and edge cases).

**Reviewer instructions**:
1. Read the requested fidelity from the prototype manifest
2. Evaluate the prototype against the fidelity-specific rubric above
3. For workspace-mode prototypes: fidelity is a URL param — do not penalize use of real design system components. Instead evaluate scope: low = core happy path only, medium = key flows with representative data, high = all flows including edge cases and error states.
4. Note specific examples of fidelity alignment or mismatch
5. If the prototype exceeds the requested fidelity scope (e.g., implements all error states when low was requested), note this as a concern — it can slow iteration and set wrong expectations
6. Assign score based on the rubric above

**Output file**: `.artifacts/{ID}/reviews/fidelity-match.md`

---

## Step 3: Write Individual Review Files

Each review file must use this format:

```markdown
---
prototype_id: "{ID}"
dimension: "{completeness|usability|feasibility|fidelity-match}"
score: {0|1|2}
reviewer: "prototype-scorer"
reviewed_at: "{ISO 8601 timestamp}"
---

# {Dimension} Review — {ID}

## Score: {score}/2 — {Pass|Partial|Fail}

## Findings

{Detailed findings from the reviewer, organized by sub-criteria}

## Evidence

{Specific references to prototype files, screens, or elements that support the score}

## Recommendations

{Actionable suggestions for improvement, if score < 2}
```

Use `python3 ${CLAUDE_SKILL_DIR}/scripts/frontmatter.py` to write frontmatter:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/frontmatter.py write \
  --file ".artifacts/{ID}/reviews/{dimension}.md" \
  --key prototype_id --value "{ID}" \
  --key dimension --value "{dimension}" \
  --key score --value "{score}" \
  --key reviewer --value "prototype-scorer" \
  --key reviewed_at --value "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

## Step 4: Score and Produce Summary

After all four dimension reviews are complete, calculate the aggregate score.

### Scoring Rules

```
Total Score    = completeness + usability + feasibility + fidelity_match
Max Score      = 8
Pass Threshold = 6+ total AND no dimension scored 0
```

| Verdict | Condition | Label |
|---------|-----------|-------|
| **Rubric Pass** | Total ≥ 6 AND min(scores) > 0 | `prototype-creator-rubric-pass` |
| **Needs Attention** | Total < 6 OR any dimension scored 0 | `prototype-creator-needs-attention` |

### Run the scorer script

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/score_prototype.py \
  --review-dir ".artifacts/{ID}/reviews" \
  --prototype-id "{ID}"
```

This reads the four `{dimension}.md` files, extracts frontmatter scores, computes the total, and writes the summary.

### Summary File Format

Write the summary to `.artifacts/{ID}/reviews/summary.md`:

```markdown
---
prototype_id: "{ID}"
total_score: {total}/8
completeness: {score}
usability: {score}
feasibility: {score}
fidelity_match: {score}
verdict: "{prototype-creator-rubric-pass|prototype-creator-needs-attention}"
reviewed_at: "{ISO 8601 timestamp}"
rfe_source: "{RFE ID from manifest}"
fidelity: "{low|medium|high}"
---

# Prototype Review Summary — {ID}

## Verdict: {verdict}

**Total Score**: {total}/8
**Threshold**: 6+ with no zeros

| Dimension | Score | Status |
|-----------|-------|--------|
| Completeness | {score}/2 | {Pass/Partial/Fail} |
| Usability | {score}/2 | {Pass/Partial/Fail} |
| Feasibility | {score}/2 | {Pass/Partial/Fail} |
| Fidelity Match | {score}/2 | {Pass/Partial/Fail} |

## Key Findings

{2–3 sentence summary of the most important findings across all dimensions}

## Strongest Dimension

{Which dimension scored highest and why}

## Areas for Improvement

{Which dimensions scored lowest, with the top 1–3 actionable recommendations}

## Dimension Details

### Completeness ({score}/2)
{1–2 sentence summary from completeness review}

### Usability ({score}/2)
{1–2 sentence summary from usability review}

### Feasibility ({score}/2)
{1–2 sentence summary from feasibility review}

### Fidelity Match ({score}/2)
{1–2 sentence summary from fidelity match review}
```

## Step 5: Apply Labels (CI Mode Only)

If the prototype's `metadata.json` has `"mode": "ci"`:

- If verdict is `prototype-creator-rubric-pass`, apply the label to the source RFE in Jira
- If verdict is `prototype-creator-needs-attention`, apply that label instead

**Skip label writes entirely when `"mode": "local"`.** Local mode is for human iteration; labels are only meaningful in the CI pipeline.

## Step 6: Report Results

Print a summary to the console:

```
────────────────────────────────────────
Prototype Review: {ID}
────────────────────────────────────────
Completeness:   {score}/2  {Pass|Partial|Fail}
Usability:      {score}/2  {Pass|Partial|Fail}
Feasibility:    {score}/2  {Pass|Partial|Fail}
Fidelity Match: {score}/2  {Pass|Partial|Fail}
────────────────────────────────────────
Total:          {total}/8
Verdict:        {verdict}
────────────────────────────────────────
```

If reviewing multiple prototypes, print a table:

```
ID              Total  Verdict
──────────────  ─────  ───────────────────────────
{ID-1}          {n}/8  {verdict}
{ID-2}          {n}/8  {verdict}
...
```

## Error Handling

- **Missing prototype**: Skip and report `"Prototype {ID} not found at .artifacts/{ID}/"`
- **Missing RFE snapshot**: Skip and report `"RFE snapshot not found at .artifacts/{ID}/rfe-snapshot.md — cannot review without original requirements"`
- **Missing manifest**: Warn `"No manifest.json — assuming medium fidelity for fidelity-match review"` and proceed
- **Scorer failure**: If a dimension's scorer fails, score that dimension as 0 and note the failure in the summary
- **Existing review**: If `.artifacts/{ID}/reviews/summary.md` already exists, ask the user whether to re-review or skip (in CI mode, always re-review)

## Next Steps

Based on the verdict, suggest the appropriate next action:

- **`prototype-creator-needs-attention`**:
  > Run `/prototype.refine` to address the review findings. Focus on dimensions that scored 0 or 1 first.

- **`prototype-creator-rubric-pass`**:
  > Prototype meets quality bar. Run `/prototype.submit` to publish, or `/prototype.test-usability` for deeper analysis before submission.

- **Any prototype with Usability < 2**:
  > Consider running `/prototype.test-usability` to simulate task-based walkthroughs and identify specific friction points beyond heuristic evaluation.
