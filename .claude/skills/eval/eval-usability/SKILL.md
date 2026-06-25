---
name: eval-usability
description: Score 7 usability dimensions using persona constraints, track patience, and optionally run think-aloud narration. Reads journey evidence, does not launch Playwright.
user-invocable: false
allowed-tools: Read, Write, Bash, Glob, Grep
---

# eval-usability

Phase 3 of the eval pipeline. Layers persona-based usability scoring on top of journey walkthroughs from eval-journey. Does NOT launch Playwright — reads existing journey-log.json and screenshots.

**Skip entirely if `.context/usability-testing/` does not exist.** Add a note: "Usability scoring skipped. Run `make context` to bootstrap."

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `.artifacts/<KEY>/journey-log.json` | Playwright step log with screenshots from eval-journey | Yes |
| `.artifacts/<KEY>/screenshots/` | Journey screenshots | Yes |
| `.artifacts/<KEY>/extract-state.json` | Persona selection, journey definitions | Yes |
| `.context/usability-testing/personas/` | Persona YAML files | Yes |
| `.context/usability-testing/prompts/evaluate-flow.md` | 7-dimension rubric | Yes |
| `--usability` | `deep` (default) or `skip` (inference only) | No |
| `--iteration` | Current iteration number (from eval-iterate) | No |

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/journey-log.json` | Updated with `usability_dimensions` section |
| `.artifacts/<KEY>/evaluation-report.csv` | Appended Section 2 (USABILITY DIMENSIONS) |
| `.artifacts/<KEY>/usability-thinkaloud-<persona-id>.md` | Per-persona think-aloud (unless skipped) |
| `.artifacts/<KEY>/refinement-suggestions.json` | Appended with usability suggestions for scores 0-1 |

## Procedure

### Step 1: Select and Load Personas

**REQUIRED: Actually read the persona YAML files.** Do not score from memory or inference alone.

#### 1a: Select personas based on target audience

Use the mapping below with `extract-state.json > persona_selection.target_audience_text`:

| RFE Target Audience | Recommended Personas |
|---------------------|---------------------|
| Data scientists, ML practitioners | `deena-junior`, `deena-senior` |
| AI/ML engineers, developers | `alex-junior`, `alex-senior` |
| MLOps, platform operators | `maude-experienced`, `maude-junior` |
| Platform admins, infrastructure | `paula-platform-engineer` |
| Accessibility-sensitive flows | `sam-accessibility` |
| Regulated/air-gapped environments | `raj-regulated` |

Always pick one junior + one senior when possible.

#### 1b: Read each selected persona's YAML file

For each selected persona, read the full file:

```
.context/usability-testing/personas/<persona-id>.yaml
```

Extract and use these sections throughout scoring:
- **`domain_knowledge`** — map of topics to skill levels (none/minimal/moderate/expert). Use this in Step 2 to determine what the persona would understand vs. find confusing.
- **`behavioral_attributes.patience`** — High/Medium/Low. Determines patience drain rates in Step 2.
- **`constraints[]`** — specific limitations (e.g., "Cannot interpret Kubernetes terminology"). Each constraint is a potential confusion trigger.
- **`jobs_to_be_done[]`** — what the persona is trying to accomplish. Use to evaluate whether the UI supports their actual goals.
- **`response_strategies`** — how the persona reacts to confusion (help-seeking, guess-and-continue, abandon). Informs the patience model.

#### 1c: Read the scoring rubric

Read the 7-dimension rubric:

```
.context/usability-testing/prompts/evaluate-flow.md
```

This file defines the specific scoring criteria for each dimension (0-3 scale). Use these criteria — not generic inference — to assign scores in Step 3. The rubric defines what "Broken" (0), "Fragmented" (1), "Functional" (2), and "Seamless" (3) mean for each specific dimension.

**IMMEDIATELY write `persona_selection` to journey-log.json** before any scoring:

```json
{
  "persona_selection": {
    "method": "automatic",
    "target_audience_text": "...",
    "target_audience_source": "...",
    "reasoning": "...",
    "selected": ["deena-junior", "deena-senior"],
    "considered_but_rejected": []
  }
}
```

### Step 2: Apply Persona Constraints to Journey Evidence

For each selected persona, re-evaluate journey steps through their lens. Do NOT re-run Playwright.

**Re-iteration shortcut (when `--iteration` > 1):** Carry forward persona overlays for journeys NOT re-run. Only re-evaluate steps from re-run journeys.

**Assisted navigation rule:** Steps with `url_fallback` or `navigate-assisted` are FAIL evidence for usability — even if the page loaded. Score based on what a real user would experience via normal UI navigation.

For each journey step, assess:
1. **Comprehension** — would this persona understand the UI elements? Check domain_knowledge map.
2. **Patience drain** — apply persona's patience model (High: -5%/-10%, Medium: -10%/-20%, Low: -15%/-30%)
3. **Knowledge gaps** — specific moments where persona constraints cause confusion

Produce per-persona journey overlay with `patience_start`, `patience_end`, `confusion_events`, `cli_escapes`, `would_complete`.

### Step 3: Score 7 Usability Dimensions

Read rubric from `.context/usability-testing/prompts/evaluate-flow.md`. Score 0-3 per dimension:

| # | Dimension | Measures |
|---|-----------|----------|
| 1 | Workflow Continuity & Integrity | Complete flow without infrastructure cliffs? |
| 2 | Cross-Persona Context & Handoffs | Context preserved across roles? |
| 3 | Scalability & Progressive Complexity | Serves both novices and experts? |
| 4 | System Status, Observability & Trust | UI explains waits and failures? |
| 5 | Technical Abstraction & Signal-to-Noise | Relevant info or infrastructure leaks? |
| 6 | Mental Model Fidelity | UI speaks user's language? |
| 7 | Accessibility & Inclusion | Keyboard nav, screen readers? |

Scale: 0=Broken, 1=Fragmented, 2=Functional, 3=Seamless.

**Score stabilization rules:**
- Assisted navigation caps score at 1 for affected dimension
- Use strictest interpretation (expected path, not alternate paths)
- Journey count must be deterministic (from extract-state.json)

### Step 4: Append Section 2 to CSV

APPEND to existing `evaluation-report.csv` (do NOT overwrite Section 1):

```
# USABILITY DIMENSIONS
dimension_id,dimension_name,score,confidence,evidence,persona_scores
workflow_continuity,Workflow Continuity,2,high,"journey-1 steps 1-4","{""deena-junior"":1,""deena-senior"":3}"
```

### Step 5: Think-Aloud Narration (conditional)

**Skip if:** `--usability=skip` OR (`--iteration` < max_iterations and `--iteration` is set)

For each selected persona (1-2), produce first-person think-aloud:

**Phase 1 — The Actor:** Walk through journey evidence in-character. Track patience, confusion events, CLI escapes. Log special events: `[CLI ESCAPE]`, `[CONTEXT LOSS]`, `[EXPECTED vs ACTUAL]`, `[MISSING FEEDBACK]`.

**Phase 2 — The Evaluator:** Switch to Senior UX Researcher. Score all 7 dimensions using Phase 1 trace as evidence. Map findings to JTBD.

**REQUIRED: Write a standalone .md file for EACH evaluated persona:**

File: `.artifacts/<KEY>/usability-thinkaloud-<persona-id>.md`

The file MUST contain (minimum 3000 characters — shorter means too shallow):

```markdown
# Think-Aloud Trace: <Persona Name>
## Feature: <ticket title>
## Task: <primary goal from journey definition>

---

### Phase 1: The Actor

STEP 1:
- What I see: [describe from screenshot/journey evidence — what the persona sees on screen]
- What I'm thinking: [first person, in-character internal monologue]
- What I'll try: [action and why]
- Confidence: [high/low/none]
- Patience: [X% — track as depleting resource]

STEP 2:
...

NAVIGATION COMPLETE:
- Outcome: [Completed / Completed with low confidence / Abandoned]
- Final patience: [X%]
- CLI escapes: [count]
- Confusion events: [count]

---

### Phase 2: The Evaluator

Target Audience Alignment: [is this persona a plausible user?]

Dimension 1: Workflow Continuity — Score: X/3
  Confidence: [High/Medium/Low]
  Evidence: [cite STEP numbers]
  Finding: [one sentence]

Dimension 2: Cross-Persona Handoffs — Score: X/3
  ...

[all 7 dimensions]

Overall: X/21
Key insight: [most actionable finding]
```

This file is what renders in the report's Personas tab. If it doesn't exist, the tab shows degraded content. The file must cover EVERY journey step with the persona's reaction — not a summary, but a step-by-step trace.

### Step 6: External Usability Evaluation (REQUIRED when .context/usability-testing/ exists)

**Skip ONLY if:** `--iteration` is set AND is NOT the final iteration (mid-loop optimization). On initial eval or final iteration, this step is MANDATORY.

This step produces the richest usability data — an independent exploratory evaluation where the persona navigates freely with no prescribed path.

#### Procedure:

1. Select the most friction-revealing persona (typically the junior variant — the one most likely to struggle)
2. Read the protocol: `.context/usability-testing/prompts/evaluate.md`
3. Execute the **Actor phase**: Navigate the prototype as the persona, think-aloud at each step, track patience
4. Execute the **Evaluator phase**: Score using the rubric from `.context/usability-testing/prompts/score.md`

#### REQUIRED outputs (these files MUST be created):

```
.artifacts/<KEY>/zack-skill-output/
  summary.md              — persona, outcome, patience, overall score, dimension scores
  phase1-thinkaloud.md    — full think-aloud trace from Actor phase
  phase2-evaluation.md    — evaluator scoring with evidence citations
```

#### summary.md format:

```markdown
# External Usability Evaluation Summary

**Persona:** <name> (<id>)
**Goal:** <primary task>
**Outcome:** Completed / Completed with low confidence / Abandoned at step N
**Final Patience:** X%
**Overall Score:** X/21

## Dimension Scores
| Dimension | Score | Confidence | Key Finding |
|-----------|-------|------------|-------------|
| Workflow Continuity | X/3 | High | ... |
| ... | | | |

## Critical Findings
1. [most important usability issue]
2. [second most important]
```

#### Verification:

After this step, check that all 3 files exist and `summary.md` is non-empty. If these files do not exist, the step was NOT completed — go back and execute the protocol.

### Step 7: Generate refinement suggestions

For dimensions scoring 0-1, generate suggestions:

```json
{
  "type": "usability",
  "dimension": "workflow_continuity",
  "score": 1,
  "persona": "deena-junior",
  "problem": "...",
  "suggested_fix": "...",
  "affected_files": [],
  "evidence_steps": [],
  "confidence": "high|medium|low"
}
```

Rules:
- Only for scores 0-1 (2-3 are acceptable)
- Must include specific persona and evidence steps
- Do NOT suggest fixes for FLAGGED criteria
- `confidence: "low"` items are logged but NOT auto-applied by eval-fix

### Step 8: Write usability_dimensions to journey-log.json

```json
{
  "usability_dimensions": {
    "source": "automated-usability-testing",
    "personas_evaluated": ["maude-experienced", "maude-junior"],
    "persona_selection": { "method": "automatic", "selected": [...], "reasoning": "..." },
    "dimensions": [
      {
        "id": "workflow_continuity",
        "name": "Workflow Continuity & Integrity",
        "scores": {
          "maude-experienced": { "score": 3, "confidence": "High", "finding": "Full flow works" },
          "maude-junior": { "score": 2, "confidence": "Medium", "finding": "Gets confused by..." }
        },
        "composite_score": 2.5
      }
    ],
    "overall_score": "15.5/21",
    "persona_overlays": [
      {
        "persona": "maude-experienced",
        "persona_name": "Maude - Experienced MLOps Engineer",
        "journey_id": "journey-1",
        "patience_start": 100,
        "patience_end": 85,
        "abandoned": false,
        "confusion_events": [
          { "step": 2, "trigger": "Column headers truncated", "knowledge_gap": "ui: expected", "patience_cost": -5 }
        ],
        "cli_escapes": 0,
        "would_complete": true
      }
    ],
    "think_aloud": {
      "personas_evaluated": ["maude-experienced"],
      "traces": [
        {
          "persona": "maude-experienced",
          "outcome": "completed",
          "patience_end": 85,
          "confusion_events": 1,
          "cli_escapes": 0,
          "response_strategies": { "help_seeking": 0, "guess_and_continue": 0, "abandon": 0 },
          "expected_vs_actual": [
            { "step": 2, "expected": "Hover tooltip", "actual": "Expandable row", "impact": "Better than expected" }
          ],
          "missing_feedback": [],
          "dimension_scores": { "workflow_continuity": { "score": 3, "confidence": "High" } },
          "narration_summary": "First-person narrative of what the persona experienced..."
        }
      ]
    }
  }
}
```

#### CRITICAL FORMAT RULES for render-report.js

- `persona_overlays` MUST always be populated (one entry per persona per journey)
- `confusion_events[].step` MUST be a NUMBER matching `journey.steps[].step` (e.g., `2`, not `"journey-1 step 2"`)
- `dimensions[].id` MUST use the 7 standard IDs (workflow_continuity, cross_persona_handoffs, etc.)
- `dimensions[].scores` MUST be keyed by persona ID with `{score, confidence, finding}`
- `think_aloud.traces` MUST be populated when `--usability=deep` — this is what renders the persona insights in the report
- `think_aloud.traces[].narration_summary` appears in the Personas tab as the think-aloud narrative
- `overall_score` MUST be a string in "X/21" format
