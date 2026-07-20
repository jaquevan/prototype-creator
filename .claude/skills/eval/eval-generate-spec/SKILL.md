---
name: eval-generate-spec
description: Generate spec.md — step-by-step UI requirements derived from eval artifacts, for Yoni's post-engineering workflow validator. Runs after eval-verify (core) and again after eval-discover (enrichment).
user-invocable: false
allowed-tools: Read, Write, Bash
---

<!-- Model: mechanical assembly — scripts/generate-spec.js does the work. No LLM judgment required to invoke it. -->

# eval-generate-spec

Assembles `.artifacts/<KEY>/spec.md` — the "step-by-step UI requirements" artifact that connects the pre-engineering eval pipeline to Yoni's post-engineering workflow validator.

**This is not new evaluation logic.** Per the 2026-07-15 Yahav/Evan alignment ("Evaluator skill output is standardized to include a spec file containing step-by-step UI requirements to improve pre-to-post engineering connectivity"), Yoni's team confirmed the shape they need is exactly what the eval pipeline already produces — `journey_definitions[].expected_path`, `ac_element_mapping`, verified verdicts, and persona task steps. This skill assembles those existing artifacts into one file; it does not generate new test data.

**Behavior over selectors:** Yoni's team runs a root-cause-analysis agent that absorbs drift when the live app's DOM differs from the prototype's. `spec.md` therefore describes plain-language UI behavior ("Click the Deploy button") as the primary content, with prototype selectors cited only as supplementary hints — not as requirements the live app must match exactly.

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `.artifacts/<KEY>/extract-state.json` | AC list, journey definitions, tasks_to_be_done | Yes |
| `.artifacts/<KEY>/evaluation-report.csv` | AC verdicts — source of truth for what's actually verified | Yes |
| `.artifacts/<KEY>/journey-log.json` | Phase A Playwright steps + screenshot evidence | Yes (core phase) |
| `.artifacts/<KEY>/component-map.json` | `ac_element_mapping` — supplementary "what to check" per AC | No |
| `.artifacts/<KEY>/persona-results.json` | Phase B per-persona task trace steps | No (required for enrichment phase content, not for the skill to run) |

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/spec.md` | Step-by-step UI requirements: Playwright-verified ACs, flagged-for-judgment ACs, not-yet-verified ACs, and (after Phase B) persona-validated task flows |

## Procedure

### Step 1: Run after Phase A exits (core phase)

Immediately after the Phase A fix loop breaks (in `eval-iterate`, right before "FINAL-STATE CAPTURE"), or any time `eval-verify` has produced a current `journey-log.json` + `evaluation-report.csv`:

```bash
node .claude/skills/eval/eval-generate-spec/scripts/generate-spec.js .artifacts/<KEY>/ --phase=core
```

This produces a `spec.md` containing only the AC section — no persona texture yet, since Phase B hasn't run. This is a complete, useful artifact on its own: it's exactly the "list of step-by-step UI actions" Yoni's team described, scoped to what Playwright has actually proven works.

### Step 2: Re-run after Phase B (enrichment phase)

After `eval-discover` completes and `persona-results.json` exists:

```bash
node .claude/skills/eval/eval-generate-spec/scripts/generate-spec.js .artifacts/<KEY>/ --phase=enrichment
```

This regenerates `spec.md` from scratch (not an append — the script is idempotent) and adds the "Persona-Validated Task Flows" section: real per-persona step sequences from live Playwright walkthroughs, grouped by task, showing what each persona actually did to accomplish each `tasks_to_be_done` entry.

If `persona-results.json` is missing when `--phase=enrichment` is passed, the script prints a warning to stderr and still writes the AC-only `spec.md` — it does not fail the pipeline.

### Step 3: Note in the report / summary

`spec.md`'s existence and AC-verified count should be mentioned in `eval-iterate`'s final summary output (e.g. "Spec file: 5/7 ACs Playwright-verified → `.artifacts/<KEY>/spec.md`") so designers know this artifact exists and roughly how complete it is.

## Verification note (out of scope for this skill)

This skill produces `spec.md` — it does not confirm Yoni's `workflow-validator` actually parses it correctly. That requires access to their tooling (GitLab, per the 2026-07-15 transcript) and is a follow-up once that access exists. Treat the current format as a best-effort match to their stated requirements ("list of step-by-step UI actions... like your persona walkthroughs"), not a confirmed contract.

## Rules

- **Never include a FAIL-verdict AC in the "Playwright-Verified" section.** Only PASS-with-evidence ACs go there — handing Yoni's validator an unproven step sequence defeats the purpose of "verified."
- **FLAGGED (T4, subjective) ACs get their own section**, clearly labeled as needing human judgment, not machine-verified.
- **Prefer plain-language step descriptions over raw selectors.** Selectors are cited as supplementary hints only, inside a note, never as the primary step text.
- **Screenshot-only steps are evidence, not user actions** — they count toward the "Verified" evidence line but are excluded from the numbered Steps list to keep it readable.
- **Idempotent regeneration, not append.** Every run reads current artifacts and rewrites `spec.md` in full. Do not hand-edit `spec.md` — edits will be lost on the next run.
