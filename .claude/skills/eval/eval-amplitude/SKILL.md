---
name: eval-amplitude
description: Exploratory spike — investigates whether Amplitude journey maps and funnels can inform Playwright test generation (journey_definitions, tasks_to_be_done). Not wired into eval-iterate. Run manually to probe API access and produce findings.
user-invocable: true
allowed-tools: Read, Write, Bash, Glob, Grep
---

<!-- Model: Sonnet-tier sufficient. This is a research/scripting spike, not a scoring or generation step. -->

# eval-amplitude

Investigation spike for [RHOAIUX-2788](https://redhat.atlassian.net/browse/RHOAIUX-2788). Answers whether Amplitude's Journeys (Pathfinder / Journey Map) and Funnels charts can supply real user paths into the eval pipeline's `journey_definitions[].expected_path` and `tasks_to_be_done[]` — the two fields that currently seed Phase A (`eval-verify`) and Phase B (`eval-discover`) Playwright generation from Jira/RFE text alone.

**This skill is intentionally NOT wired into `eval-iterate`.** It is a standalone research tool. See `README.md` in this directory for full findings — read that first before running anything here.

## Status (read this before running)

- **No Amplitude MCP plugin is installed** in this Cursor environment. Check `mcp__amplitude__*` availability before assuming any tool call below works.
- **Funnels** have a real, documented REST endpoint (`GET /api/2/funnels`) — usable today with an Amplitude API key/secret pair.
- **Journeys** (the actual Pathfinder/Journey Map charts Yahav demoed) have **no direct REST export**. The Dashboard REST API only exports "Data Table" chart types from a saved report, and Journey Map isn't that chart type. The "save the chart to a report first" workaround discussed in the 2026-07-02 meeting likely does not solve this.
- Only ~4 external participants were in the Amplitude data as of the 2026-07-02 meeting — even if the API access works, the sample may be too small to be meaningful yet.

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `AMPLITUDE_API_KEY` / `AMPLITUDE_SECRET_KEY` env vars | Amplitude project credentials (request from Yahav) | Yes, for live probing |
| `.artifacts/<KEY>/extract-state.json` | Target schema for the transform script | Yes, for `journey-to-extract.py` |

## Outputs

| File | Description |
|------|-------------|
| `samples/sample-journey-funnel.json` | Mocked realistic Amplitude response (funnel shape), used when live access is unavailable |
| `README.md` | Findings: API capability matrix, blockers, mapping strategy, recommendation |

## Procedure

### Step 1: Check for live access

```bash
echo "${AMPLITUDE_API_KEY:+set}${AMPLITUDE_API_KEY:-unset}"
```

If unset, skip Step 2 and use `samples/sample-journey-funnel.json` for Step 3 instead.

### Step 2: Probe the Funnels API (if credentials available)

```bash
python3 scripts/amplitude-funnel-probe.py --events "evaluations benchmark run selected,mlflow experiment created" --start 20260701 --end 20260720
```

This calls the documented `/api/2/funnels` endpoint directly (no MCP dependency). Document the actual response shape in `README.md` under "Live probe results" — do not assume the mocked sample matches reality until this has been run.

### Step 3: Transform sample/live data into the eval schema

```bash
python3 scripts/journey-to-extract.py samples/sample-journey-funnel.json --out /tmp/amplitude-journey-seed.json
```

Reads Amplitude event-sequence data and emits a fragment shaped like `extract-state.json`'s `journey_definitions[]` (with a `risk_weight` per step derived from funnel drop-off), so downstream skills would not need schema changes to consume it.

### Step 4: Update findings

Append results to `README.md` — this is the artifact that answers RHOAIUX-2788, not code that ships into the pipeline yet.

## Rules

- Do NOT wire this into `eval-iterate` or `eval-extract` in this pass — the findings doc must recommend proceeding first.
- Do NOT fabricate Amplitude API responses as if they were real probe results — always label mocked data as mocked in `README.md`.
- If `AMPLITUDE_API_KEY` is unavailable, the spike still produces value by documenting the schema mapping and API capability matrix — do not block on access.
