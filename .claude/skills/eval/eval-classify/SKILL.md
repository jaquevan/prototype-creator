---
name: eval-classify
description: Classify acceptance criteria into evaluation tiers and initialize the evaluation CSV. Pure logic, no Playwright.
user-invocable: false
allowed-tools: Read, Write, Bash, Glob, Grep
---

# eval-classify

Phase 2a of the eval pipeline. Classifies each acceptance criterion into a tier that determines *how* to evaluate it, and initializes the evaluation CSV with headers and tier assignments.

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `.artifacts/<KEY>/extract-state.json` | AC list with references, from eval-extract | Yes |
| `config/csv-schema.yaml` | CSV section/column definitions | Yes |
| `--rerun-only` | Comma-separated AC IDs to re-classify (iteration 2+) | No |

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/evaluation-report.csv` | Section 1 initialized with headers + tier assignments (no verdicts yet) |

## Tier Definitions

| Tier | What it means | Verdict options | Example |
|------|---------------|-----------------|---------|
| **T1** | Checkable from prototype source code | PASS or FAIL | "A form-based UI for defining roles" |
| **T2** | Needs external reference to compare | PASS, FAIL, or FLAG | "Align with ACM role creation UI" |
| **T3** | Needs runtime/backend to fully verify | Split: UI (PASS/FAIL) + backend (FLAG) | "Validate inputs for valid RBAC" |
| **T4** | Subjective/interpretive | Evidence + FLAG | "Translate K8s terms to user-friendly" |
| **T5** | Requires headed browser / hardware | Auto-FLAGGED (headless_limitation) | "Microphone button records audio" |

## Procedure

### Step 1: Read extract-state.json

Load the AC list and criterion-to-reference map from `.artifacts/<KEY>/extract-state.json`.

### Step 2: Classify each criterion

For each AC in the list, determine its tier:

**Tier 1 — Self-evident from prototype:**
- Criteria about UI elements, forms, components, or flows that exist (or don't)
- Keywords: "UI for", "page that shows", "button to", "form with fields"
- Verdict: PASS or FAIL only

**Tier 2 — Requires external reference:**
- Criteria referencing another product, system, or standard
- Check the reference map: does this AC have a fetchable reference URL?
- If reference URL exists → T2 (attempt comparison)
- If doc reference but no URL → T2 (FLAG with pointer)
- If no reference at all → T2 (FLAG, cannot verify)

**Tier 3 — Requires runtime/backend:**
- Criteria about validation logic, API behavior, backend state
- Split into checkable UI part + FLAG for backend part
- Keywords: "validates", "ensures", "prevents invalid", "integrates with API"

**Tier 4 — Subjective/interpretive:**
- Criteria about readability, user-friendliness, qualitative characteristics
- Keywords: "user-friendly", "intuitive", "clear", "appropriate"
- Provide evidence, then FLAG

**Tier 5 — Requires headed browser / hardware:**
- Criteria that cannot be verified in headless Chromium (hardware APIs, device permissions)
- Keywords: microphone, camera, webcam, geolocation, file drag-and-drop (not file input), clipboard paste, WebRTC, screen sharing, device APIs, getUserMedia, audio recording, video capture
- Auto-FLAGGED before journey runs with rationale "Requires headed browser" and human_action "Verify manually in headed browser"
- Do NOT generate journey steps for T5 ACs — set verdict immediately at classification time

### Step 3: Handle selective re-classification (`--rerun-only`)

When `--rerun-only` is set (iterations 2+):
1. Read the existing `evaluation-report.csv`
2. Carry forward rows for criteria NOT in `--rerun-only` (verbatim, including their verdicts)
3. Only re-classify criteria in the `--rerun-only` list
4. Merge results into the CSV

### Step 4: Write evaluation-report.csv (Section 1 header + tier rows)

```
# ACCEPTANCE CRITERIA
criterion_id,source,tier,criterion_text,verdict,rationale,evidence,fix_action,fix_file,human_action
AC-1,jira,T1,"A form-based UI for defining custom roles",,,,,,
AC-2,jira,T2,"Align with ACM role creation UI",,,,,,
AC-3,jira,T3,"Validate inputs to ensure RBAC is valid",,,,,,
```

All 10 columns are required per `config/csv-schema.yaml`. Leave `verdict`, `rationale`, `evidence`, `fix_action`, `fix_file`, `human_action` empty — eval-journey fills those in.

## Rules

- Classification is deterministic given the same inputs. Same AC text + same references = same tier.
- Never assign a verdict during classification. Tiers only determine HOW to evaluate.
- Every criterion gets a tier. No criterion is skipped.
- The CSV schema is strict — all 10 columns must be present, even if empty.
