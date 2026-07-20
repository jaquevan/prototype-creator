---
name: eval-classify
description: Classify acceptance criteria into evaluation tiers and initialize the evaluation CSV. Pure logic, no Playwright.
user-invocable: false
allowed-tools: Read, Write, Bash, Glob, Grep
---

<!-- Model: Sonnet-tier sufficient. Classification is keyword-driven with a T1 default. Use classify-tiers.js script for 80%+ of cases. -->

# eval-classify

Phase 2a of the eval pipeline. Classifies each acceptance criterion into a tier that determines *how* to evaluate it, and initializes the evaluation CSV with headers and tier assignments.

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `.artifacts/<KEY>/extract-state.json` | AC list with references and feature_context, from eval-extract | Yes |
| `config/csv-schema.yaml` | CSV section/column definitions | Yes |

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/evaluation-report.csv` | Section 1 initialized with headers + tier assignments (no verdicts yet) |

## Tier Definitions

These prototypes are **functional TypeScript applications** built with Cursor -- they have real navigation, clickable UI, forms, data tables, modals, and often simulated API responses. The tier system should reflect what is actually testable from this kind of prototype, not from a static wireframe.

**Guiding principle:** Minimize FLAGGEDs. A FLAGGED verdict that cannot be resolved triggers fix loop iterations that waste time. Only flag what genuinely requires a human designer's judgment. Everything else should get a clear PASS or FAIL.

| Tier | What it means | Verdict options | When to use |
|------|---------------|-----------------|-------------|
| **T1** | Verifiable from the prototype UI | PASS or FAIL | Any AC where the answer is visible: elements exist, flows work, text appears, interactions respond. This is the default tier -- most ACs in a functional prototype are T1. |
| **T3** | Backend-only with no UI surface | PASS (noted) | AC describes purely backend behavior with zero UI manifestation (e.g., "BFF validates request size", "API rate limits"). These auto-PASS with a note -- the prototype's job is to demonstrate UX, not implement backends. |
| **T4** | Subjective -- needs human designer judgment | FLAGGED with evidence | AC requires qualitative assessment: "user-friendly", "intuitive", "appropriate language", "clear hierarchy". Provide screenshot evidence and flag for human review. This is the ONLY tier that should routinely produce FLAGGEDs. |

## Procedure

**Preferred: use the deterministic pre-classifier** for obvious cases:
```bash
node .claude/skills/eval/scripts/classify-tiers.js .artifacts/<KEY>/
```
Review the output — if any edge cases need reclassification (e.g., an AC with backend language that has a UI manifestation), manually adjust the CSV tier column. The script handles 80-90% of cases correctly.

### Step 1: Read extract-state.json

Load the AC list, criterion-to-reference map, and `feature_context` from `.artifacts/<KEY>/extract-state.json`.

If `feature_context.ui_enhancements` exists, use it as supplementary signal for tier decisions -- it describes what the prototype is supposed to visually demonstrate.

### Step 2: Classify each criterion

For each AC in the list, determine its tier. **Default to T1 unless there is a strong reason not to.** These are functional prototypes — if it's about UI, it's testable. This is the single authoritative rule: T1 is the default. Only classify as T3 or T4 when the criteria below are clearly met.

**Tier 1 — Verifiable from prototype (DEFAULT):**
- Criteria about UI elements, forms, components, flows, visibility, navigation, interactions
- Criteria about conditional rendering ("when X, show Y" / "when X, hide Y")
- Criteria about data display (tables, lists, status indicators, labels, tooltips)
- Criteria about real-time updates -- if the prototype renders from state, re-renders are testable even without a real backend
- Criteria about error states -- if the prototype shows error UI, that's testable
- Criteria mentioning backend concepts BUT whose observable effect is a UI change -- **still T1**. Examples:
  - "validates inputs" → T1 if the prototype shows validation UI (red borders, error messages)
  - "updates within 5 seconds" → T1 if the prototype re-renders from state (timing is a backend concern, but the UI update is visible)
  - "RBAC prevents access" → T1 if the prototype shows a graceful degradation state
  - "covers both InferenceService and LLMInferenceService" → T1 if the prototype renders both in mock data

**Use `feature_context.ui_enhancements` to confirm T1:** If the UI enhancements section describes specific visual elements (columns, tooltips, labels, panels) that an AC references, the AC is T1 regardless of backend language in the AC text.

**Tier 3 — Backend-only, no UI surface:**
- ONLY for ACs that describe purely backend/infrastructure behavior with zero observable UI effect
- Examples: "BFF accepts 50MB request bodies", "catalog YAML schema validates", "API returns 429 after rate limit"
- These auto-PASS with note: "Backend-only -- no UI component to evaluate. Noted for engineering."
- If the AC has ANY UI manifestation (error message, loading state, empty state, disabled button), it is NOT T3 -- it is T1

**Tier 4 — Subjective, needs human judgment:**
- Criteria about quality, readability, appropriateness, user-friendliness that cannot be objectively verified
- Keywords: "user-friendly", "intuitive", "clear", "appropriate", "natural language"
- Provide evidence (screenshots) and FLAGGED for the designer to judge
- This is the only tier that should routinely produce FLAGGEDs that might trigger attention

### Step 3: Write evaluation-report.csv (Section 1 header + tier rows)

```
# ACCEPTANCE CRITERIA
criterion_id,source,tier,criterion_text,verdict,rationale,evidence,fix_action,fix_file,human_action
AC-1,jira,T1,"Kueue status displays scheduling state in Status column",,,,,,
AC-2,jira,T1,"No Kueue indicators when feature disabled",,,,,,
AC-3,jira,T3,"BFF validates request body size",,Backend-only -- no UI component to evaluate. Noted for engineering.,,,,
AC-4,jira,T4,"User-friendly terminology for scheduling states",,,,,,Assess whether status labels use appropriate plain language
```

All 10 columns are required per `config/csv-schema.yaml`. Leave `verdict`, `rationale`, `evidence`, `fix_action`, `fix_file`, `human_action` empty for T1 — eval-verify fills those in. For T3 (backend-only), set verdict to PASS immediately with a rationale note. For T4, leave verdict empty but populate `human_action` with what the designer should assess.

## Rules

- Classification is deterministic given the same inputs. Same AC text + same references + same feature_context = same tier.
- T3 ACs get their verdict assigned at classification time (PASS with note). They do NOT enter the journey loop.
- T4 ACs get FLAGGED after eval-verify provides evidence. They are the only tier expected to produce FLAGGEDs.
- Never generate journey steps for T3 ACs (backend-only, no UI to test).
- Every criterion gets a tier. No criterion is skipped.
- The CSV schema is strict — all 10 columns must be present, even if empty.
